import type { Rule } from "./index";

import { Pool } from "pg";

export type RuleDimensions = Record<string, string | string[]>;

export interface PostgresConfig {
  connection_string_env: string;
  schema: string;
  namespace: string;
}

export interface PostgresRuleInput {
  title: string;
  summary: string;
  description: string;
  raw_description?: string;
  conditions: string[];
  actions: string[];
  priority: Rule["priority"];
  tags: string[];
  scope: string[];
  dimensions: RuleDimensions;
  references: string[];
  created_by_email?: string;
}

function quoteIdentifier(identifier: string): string {
  if (!/^[a-z_][a-z0-9_]*$/i.test(identifier)) {
    throw new Error(`Invalid PostgreSQL schema name: ${identifier}`);
  }
  return `"${identifier.replace(/"/g, '""')}"`;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String) : [];
}

function normalizeDimensions(dimensions: RuleDimensions, scope: string[]): Array<[string, string]> {
  const values = new Map<string, Set<string>>();
  for (const [name, raw] of Object.entries(dimensions ?? {})) {
    if (!/^[a-z][a-z0-9_]*$/i.test(name)) {
      throw new Error(`Invalid rule dimension name: ${name}`);
    }
    const list = Array.isArray(raw) ? raw : [raw];
    if (!list.length || list.some(value => typeof value !== 'string' || !value.trim())) throw new Error(`Dimension ${name} needs non-empty values`);
    const normalized = values.get(name) ?? new Set<string>();
    for (const value of list) {
      if (String(value).trim()) normalized.add(String(value).trim());
    }
    if (normalized.size > 0) values.set(name, normalized);
  }

  // Preserve the Markdown scope contract as the customer dimension.
  if (scope.length > 0 && !values.has("customer")) {
    values.set("customer", new Set(scope.map(String).filter(Boolean)));
  }

  return [...values.entries()].flatMap(([name, list]) =>
    [...list].map((value) => [name, value] as [string, string])
  );
}

export class PostgresRuleStore {
  private readonly pool: Pool;
  private readonly schema: string;
  private readonly namespace: string;

  constructor(config: PostgresConfig) {
    const connectionString = process.env[config.connection_string_env];
    if (!connectionString) {
      throw new Error(
        `PostgreSQL storage is enabled but ${config.connection_string_env} is not set`
      );
    }

    this.schema = quoteIdentifier(config.schema);
    this.namespace = config.namespace;
    if (!config.namespace?.trim()) throw new Error('PostgreSQL namespace is required');
    this.pool = new Pool({ connectionString, max: 5, connectionTimeoutMillis: 5000, statement_timeout: 15000, idleTimeoutMillis: 10000 });
    this.pool.on('error', () => { /* Failed idle clients are removed by pg. */ });
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  private table(name: string): string {
    return `${this.schema}."${name}"`;
  }

  private async rowToRule(row: any): Promise<Rule> {
    const dimensions = await this.pool.query(
      `SELECT dimension_name, dimension_value
         FROM ${this.table("rule_dimensions")}
        WHERE namespace = $1 AND rule_id = $2
        ORDER BY dimension_name, dimension_value`,
      [row.namespace, row.id]
    );

    const dimensionMap: RuleDimensions = Object.create(null);
    for (const item of dimensions.rows) {
      const current = dimensionMap[item.dimension_name];
      if (current === undefined) dimensionMap[item.dimension_name] = item.dimension_value;
      else if (Array.isArray(current)) current.push(item.dimension_value);
      else dimensionMap[item.dimension_name] = [current, item.dimension_value];
    }

    const customer = dimensionMap.customer;
    const scope = customer === undefined ? [] : Array.isArray(customer) ? customer : [customer];

    return {
      id: row.id,
      title: row.title,
      status: row.status,
      priority: row.priority,
      tags: asStringArray(row.tags),
      summary: row.summary,
      description: row.description,
      raw_description: row.raw_description ?? undefined,
      scope,
      dimensions: dimensionMap,
      created_by_email: row.created_by_email ?? undefined,
      updated_by_email: row.updated_by_email ?? undefined,
      conditions: asStringArray(row.conditions),
      actions: asStringArray(row.actions),
      references: asStringArray(row.references),
      created: new Date(row.created_at).toISOString(),
      updated: new Date(row.updated_at).toISOString(),
    };
  }

  async list(status?: Rule["status"], context?: RuleDimensions): Promise<Rule[]> {
    const result = await this.pool.query(
      `SELECT r.*, COALESCE((SELECT jsonb_agg(reference ORDER BY reference) FROM ${this.table("rule_references")} rr WHERE rr.namespace=r.namespace AND rr.rule_id=r.id), '[]'::jsonb) AS references
         FROM ${this.table("rules")} r
        WHERE namespace = $1
          AND archived_at IS NULL
          AND ($2::text IS NULL OR status = $2)
        ORDER BY CASE priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END,
                 updated_at DESC`,
      [this.namespace, status ?? null]
    );
    const rules = await Promise.all(result.rows.map((row: any) => this.rowToRule(row)));
    return rules.filter(rule => context === undefined || matchesDimensions(rule.dimensions ?? {}, context))
      .sort((a, b) => ({high:0,medium:1,low:2}[a.priority] - {high:0,medium:1,low:2}[b.priority]) || Object.keys(b.dimensions ?? {}).length - Object.keys(a.dimensions ?? {}).length);
  }

  async get(id: string): Promise<Rule | null> {
    const result = await this.pool.query(
      `SELECT r.*,
              COALESCE(jsonb_agg(rr.reference) FILTER (WHERE rr.reference IS NOT NULL), '[]'::jsonb) AS references
         FROM ${this.table("rules")} r
         LEFT JOIN ${this.table("rule_references")} rr
           ON rr.namespace = r.namespace AND rr.rule_id = r.id
        WHERE r.namespace = $1 AND r.id = $2 AND r.archived_at IS NULL
        GROUP BY r.namespace, r.id`,
      [this.namespace, id]
    );
    return result.rows.length === 0 ? null : this.rowToRule(result.rows[0]);
  }

  async add(input: PostgresRuleInput): Promise<Rule> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", ['pi-ruleset:' + this.schema + ':' + this.namespace]);

      const idResult = await client.query(
        `SELECT COALESCE(MAX(CASE WHEN id ~ '^[0-9]+$' THEN id::integer END), 0) + 1 AS next_id
           FROM ${this.table("rules")}
          WHERE namespace = $1`,
        [this.namespace]
      );
      const id = String(idResult.rows[0].next_id).padStart(3, "0");
      const now = new Date();

      await client.query(
        `INSERT INTO ${this.table("rules")} (
           namespace, id, title, status, priority, tags, summary, description,
           raw_description, conditions, actions, created_at, updated_at, created_by_email,
           updated_by_email
         ) VALUES ($1, $2, $3, 'active', $4, $5::jsonb, $6, $7, $8, $9::jsonb, $10::jsonb, $11, $11, $12, $12)`,
        [
          this.namespace,
          id,
          input.title,
          input.priority,
          JSON.stringify(input.tags),
          input.summary,
          input.description,
          input.raw_description ?? null,
          JSON.stringify(input.conditions),
          JSON.stringify(input.actions),
          now,
          input.created_by_email ?? null,
        ]
      );

      for (const [name, value] of normalizeDimensions(input.dimensions, input.scope)) {
        await client.query(
          `INSERT INTO ${this.table("rule_dimensions")} (namespace, rule_id, dimension_name, dimension_value)
           VALUES ($1, $2, $3, $4)`,
          [this.namespace, id, name, value]
        );
      }

      for (const reference of new Set(input.references)) {
        await client.query(
          `INSERT INTO ${this.table("rule_references")} (namespace, rule_id, reference)
           VALUES ($1, $2, $3)`,
          [this.namespace, id, reference]
        );
      }

      await client.query("COMMIT");
      const dimensions: RuleDimensions = Object.create(null);
      for (const [name,value] of normalizeDimensions(input.dimensions,input.scope)) {
        (dimensions[name] ??= [] as string[]);
        (dimensions[name] as string[]).push(value);
      }
      return { ...input, dimensions, scope: (dimensions.customer ?? []) as string[], updated_by_email: input.created_by_email, id, status: 'active', created: now.toISOString(), updated: now.toISOString() };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async checkSchema(): Promise<void> {
    const result = await this.pool.query(`SELECT max(version) AS version FROM ${this.table('schema_migrations')}`);
    if (result.rows[0].version !== 2) throw new Error('pi-ruleset requires schema version 2; administrator must apply migrations/001_init.sql and 002_storage.sql');
  }

  async update(id: string, patch: Partial<Rule>, email?: string): Promise<Rule | null> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const found = await client.query(`SELECT id FROM ${this.table('rules')} WHERE namespace=$1 AND id=$2 AND archived_at IS NULL FOR UPDATE`, [this.namespace, id]);
      if (!found.rowCount) { await client.query('ROLLBACK'); return null; }
      const columns: Record<string, string> = { title:'title', summary:'summary', description:'description', raw_description:'raw_description', status:'status', priority:'priority', tags:'tags', conditions:'conditions', actions:'actions' };
      const values: unknown[] = [this.namespace, id, email ?? null];
      const sets = ['updated_at=now()', 'updated_by_email=$3'];
      for (const [key, column] of Object.entries(columns)) {
        const value = patch[key as keyof Rule];
        if (value === undefined) continue;
        const json = ['tags','conditions','actions'].includes(key);
        values.push(json ? JSON.stringify(value) : value);
        sets.push(`${column}=$${values.length}${json ? '::jsonb' : ''}`);
      }
      await client.query(`UPDATE ${this.table('rules')} SET ${sets.join(',')} WHERE namespace=$1 AND id=$2`, values);
      if (patch.dimensions !== undefined || patch.scope !== undefined) {
        if (patch.dimensions !== undefined) await client.query(`DELETE FROM ${this.table('rule_dimensions')} WHERE namespace=$1 AND rule_id=$2`, [this.namespace,id]);
        else await client.query(`DELETE FROM ${this.table('rule_dimensions')} WHERE namespace=$1 AND rule_id=$2 AND dimension_name='customer'`, [this.namespace,id]);
        for (const [name,value] of normalizeDimensions(patch.dimensions ?? {}, patch.scope ?? [])) {
          await client.query(`INSERT INTO ${this.table('rule_dimensions')} VALUES ($1,$2,$3,$4)`, [this.namespace,id,name,value]);
        }
      }
      if (patch.references !== undefined) {
        await client.query(`DELETE FROM ${this.table('rule_references')} WHERE namespace=$1 AND rule_id=$2`, [this.namespace,id]);
        for (const reference of new Set(patch.references)) await client.query(`INSERT INTO ${this.table('rule_references')} VALUES ($1,$2,$3)`, [this.namespace,id,reference]);
      }
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
    return this.get(id);
  }

  async remove(id: string, email?: string): Promise<boolean> {
    const result = await this.pool.query(`UPDATE ${this.table('rules')} SET archived_at=now(), updated_at=now(), updated_by_email=$3 WHERE namespace=$1 AND id=$2 AND archived_at IS NULL`, [this.namespace,id,email ?? null]);
    return result.rowCount === 1;
  }

  async restore(id: string, email?: string): Promise<boolean> {
    const result = await this.pool.query(`UPDATE ${this.table('rules')} SET archived_at=NULL, updated_at=now(), updated_by_email=$3 WHERE namespace=$1 AND id=$2 AND archived_at IS NOT NULL`, [this.namespace,id,email ?? null]);
    return result.rowCount === 1;
  }

  async addReference(name: string, content: string): Promise<void> {
    await this.pool.query(`INSERT INTO ${this.table('reference_documents')} (namespace,name,content) VALUES ($1,$2,$3) ON CONFLICT (namespace,name) DO UPDATE SET content=excluded.content`, [this.namespace,name,content]);
  }

  async getReference(name: string): Promise<string | null> {
    const result = await this.pool.query(`SELECT content FROM ${this.table('reference_documents')} WHERE namespace=$1 AND name=$2`, [this.namespace,name]);
    return result.rows[0]?.content ?? null;
  }
}

export function matchesDimensions(required: RuleDimensions, context: RuleDimensions): boolean {
  return Object.entries(required).every(([key, raw]) => {
    const expected = Array.isArray(raw) ? raw : [raw];
    const actual = context[key];
    return actual !== undefined && expected.some(value => (Array.isArray(actual) ? actual : [actual]).includes(value));
  });
}
