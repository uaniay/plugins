import type { Rule } from "./index";
import { Pool } from "pg";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

export type RuleDimensions = Record<string, string | string[]>;

export interface PostgresConfig {
  schema: string;
  sslmode?: "disable" | "require" | "verify-ca" | "verify-full";
  ssl_ca_file?: string;
}

export interface PostgresRuleInput {
  title: string;
  summary: string;
  description: string;
  raw_description?: string;
  conditions: string[];
  actions: string[];
  tags: string[];
  customer?: string; // Legacy shorthand, interpreted as a name.
  customer_scope?: "all" | "specific";
  customer_id?: string;
  customer_name?: string;
  facility?: string; // Legacy shorthand, interpreted as a name.
  facility_scope?: "all" | "specific";
  facility_id?: string;
  facility_name?: string;
  cycle: string;
  references: string[];
  created_by_email?: string;
}

function quoteIdentifier(identifier: string): string {
  if (!/^[a-z_][a-z0-9_]*$/i.test(identifier)) throw new Error(`Invalid PostgreSQL schema name: ${identifier}`);
  return `"${identifier.replace(/"/g, '""')}"`;
}

function sslConfig(config: PostgresConfig): false | { ca?: string; rejectUnauthorized: boolean; checkServerIdentity?: () => undefined } {
  const mode = config.sslmode ?? process.env.PGSSLMODE ?? "disable";
  if (!["disable", "require", "verify-ca", "verify-full"].includes(mode)) {
    throw new Error("PostgreSQL sslmode must be disable, require, verify-ca, or verify-full");
  }
  if (mode === "disable") return false;
  if (mode === "require") return { rejectUnauthorized: false };
  const ca = config.ssl_ca_file ? readFileSync(config.ssl_ca_file, "utf-8") : undefined;
  return {
    ...(ca ? { ca } : {}),
    rejectUnauthorized: true,
    ...(mode === "verify-ca" ? { checkServerIdentity: () => undefined } : {}),
  };
}

function asStringArray(value: unknown): string[] { return Array.isArray(value) ? value.map(String) : []; }

function matchValue(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${field} needs a non-empty string`);
  return value.trim();
}

type Party = { scope: "all" | "specific"; id: string | null; name: string | null };
type PartyKey = "customer" | "facility";

function optionalValue(value: unknown, field: string): string | null {
  return value === undefined || value === null ? null : matchValue(value, field);
}

function partyFromInput(input: Record<string, unknown>, key: PartyKey, current?: Party): Party {
  const legacy = input[key];
  const scope = input[`${key}_scope`];
  const hasId = input[`${key}_id`] !== undefined;
  const hasName = input[`${key}_name`] !== undefined;
  if (legacy !== undefined && (hasId || hasName)) throw new Error(`${key}: use either the legacy value or explicit id/name fields`);
  if (scope !== undefined && scope !== "all" && scope !== "specific") throw new Error(`${key}_scope must be all or specific`);

  if (legacy !== undefined) {
    const value = matchValue(legacy, key);
    if (value === "all") {
      if (scope === "specific") throw new Error(`${key}: all conflicts with specific scope`);
      return { scope: "all", id: null, name: null };
    }
    if (scope === "all") throw new Error(`${key}: a name conflicts with all scope`);
    return { scope: "specific", id: null, name: value };
  }

  if (scope === "all") {
    if (hasId || hasName) throw new Error(`${key}: all scope cannot contain an id or name`);
    return { scope: "all", id: null, name: null };
  }
  if (scope === "specific" || hasId || hasName) {
    const id = hasId ? optionalValue(input[`${key}_id`], `${key}_id`) : (hasName ? null : current?.id ?? null);
    const name = hasName ? optionalValue(input[`${key}_name`], `${key}_name`) : (hasId ? null : current?.name ?? null);
    if (!id && !name) throw new Error(`${key}: specific scope requires an id or name`);
    return { scope: "specific", id, name };
  }
  return current ?? { scope: "all", id: null, name: null };
}

function partyFromRow(row: any, key: PartyKey): Party {
  return { scope: row[`${key}_scope`], id: row[`${key}_id`], name: row[`${key}_name`] };
}

function partyDisplay(party: Party): string { return party.scope === "all" ? "all" : party.id ?? party.name ?? "all"; }

function ruleDimensions(row: any): RuleDimensions {
  const customer = partyFromRow(row, "customer");
  const facility = partyFromRow(row, "facility");
  return {
    customer: partyDisplay(customer), customer_scope: customer.scope,
    ...(customer.id ? { customer_id: customer.id } : {}), ...(customer.name ? { customer_name: customer.name } : {}),
    facility: partyDisplay(facility), facility_scope: facility.scope,
    ...(facility.id ? { facility_id: facility.id } : {}), ...(facility.name ? { facility_name: facility.name } : {}),
    item: row.item, cycle: row.cycle,
  };
}

function scopeFromCustomer(customer: Party): string[] { return customer.scope === "all" ? [] : [partyDisplay(customer)]; }

export class PostgresRuleStore {
  private readonly pool: Pool;
  private readonly schema: string;
  private readonly namespace: string;

  constructor(config: PostgresConfig) {
    const requiredEnvironment = ["DB_HOST", "DB_PORT", "DB_USER", "DB_NAME", "DB_PASSWORD"] as const;
    const missing = requiredEnvironment.filter(name => !process.env[name]);
    if (missing.length > 0) throw new Error(`PostgreSQL storage is enabled but ${missing.join(", ")} ${missing.length === 1 ? "is" : "are"} not set`);
    const port = Number(process.env.DB_PORT);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("DB_PORT must be an integer between 1 and 65535");
    this.schema = quoteIdentifier(config.schema);
    this.namespace = process.env.AGENT_NAME?.trim() || "default";
    this.pool = new Pool({
      host: process.env.DB_HOST,
      port,
      user: process.env.DB_USER,
      database: process.env.DB_NAME,
      password: process.env.DB_PASSWORD,
      ssl: sslConfig(config),
      max: 5,
      connectionTimeoutMillis: 5000,
      statement_timeout: 15000,
      idleTimeoutMillis: 10000,
    });
    this.pool.on("error", () => { /* Failed idle clients are removed by pg. */ });
  }

  async close(): Promise<void> { await this.pool.end(); }
  private table(name: string): string { return `${this.schema}."${name}"`; }

  private rowToRule(row: any): Rule {
    const dimensions = ruleDimensions(row);
    return {
      id: row.id, title: row.title, item_name: row.item_name, status: row.status, priority: "medium",
      tags: asStringArray(row.tags), summary: row.summary, description: row.description,
      raw_description: row.raw_description ?? undefined, scope: scopeFromCustomer(partyFromRow(row, "customer")), dimensions,
      created_by_email: row.created_by_email ?? undefined, updated_by_email: row.updated_by_email ?? undefined,
      conditions: asStringArray(row.conditions), actions: asStringArray(row.actions),
      references: asStringArray(row.reference_names), created: new Date(row.created_at).toISOString(),
      updated: new Date(row.updated_at).toISOString(),
    };
  }

  async list(status?: Rule["status"], context?: RuleDimensions): Promise<Rule[]> {
    const result = await this.pool.query(
      `SELECT * FROM ${this.table("rules")}
        WHERE namespace = $1 AND archived_at IS NULL
          AND ($2::text IS NULL OR status = $2)
        ORDER BY updated_at DESC`, [this.namespace, status ?? null]
    );
    return result.rows.map((row: any) => this.rowToRule(row))
      .filter(rule => context === undefined || matchesDimensions(rule.dimensions ?? {}, context))
      .sort((a, b) => specificity(b.dimensions) - specificity(a.dimensions));
  }

  async get(id: string): Promise<Rule | null> {
    const result = await this.pool.query(`SELECT * FROM ${this.table("rules")} WHERE namespace=$1 AND id=$2 AND archived_at IS NULL`, [this.namespace, id]);
    return result.rows.length === 0 ? null : this.rowToRule(result.rows[0]);
  }

  async add(input: PostgresRuleInput): Promise<Rule> {
    if ("item" in input || "item_name" in input) throw new Error("item and item_name are generated and cannot be supplied");
    const title = matchValue(input.title, "title");
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`pi-ruleset:${this.schema}:${this.namespace}`]);
      const idResult = await client.query(`SELECT COALESCE(MAX(CASE WHEN id ~ '^[0-9]+$' THEN id::integer END), 0) + 1 AS next_id FROM ${this.table("rules")} WHERE namespace=$1`, [this.namespace]);
      const id = String(idResult.rows[0].next_id).padStart(3, "0");
      const now = new Date();
      const customer = partyFromInput(input as unknown as Record<string, unknown>, "customer");
      const facility = partyFromInput(input as unknown as Record<string, unknown>, "facility");
      const item = randomUUID();
      const cycle = matchValue(input.cycle, "cycle");
      await client.query(
        `INSERT INTO ${this.table("rules")} (
           namespace,id,title,status,tags,summary,description,raw_description,conditions,actions,
           customer_scope,customer_id,customer_name,facility_scope,facility_id,facility_name,
           item,cycle,reference_names,created_at,updated_at,created_by_email,updated_by_email
         ) VALUES ($1,$2,$3,'active',$4::jsonb,$5,$6,$7,$8::jsonb,$9::jsonb,
           $10,$11,$12,$13,$14,$15,$16,$17,$18::jsonb,$19,$19,$20,$20)`,
        [this.namespace,id,title,JSON.stringify(input.tags),input.summary,input.description,input.raw_description ?? null,
          JSON.stringify(input.conditions),JSON.stringify(input.actions),customer.scope,customer.id,customer.name,
          facility.scope,facility.id,facility.name,item,cycle,
          JSON.stringify([...new Set(input.references)]),now,input.created_by_email ?? null]
      );
      await client.query("COMMIT");
      const dimensions = ruleDimensions({customer_scope:customer.scope,customer_id:customer.id,customer_name:customer.name,
        facility_scope:facility.scope,facility_id:facility.id,facility_name:facility.name,item,cycle});
      return { ...input, title, item_name: title, dimensions, scope: scopeFromCustomer(customer), updated_by_email: input.created_by_email,
        id, status: "active", priority: "medium", created: now.toISOString(), updated: now.toISOString() };
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  }

  async checkSchema(): Promise<void> {
    const result = await this.pool.query(`SELECT max(version) AS version FROM ${this.table("schema_migrations")}`);
    if (result.rows[0].version !== 4) throw new Error("pi-ruleset requires schema version 4; apply migrations/001_init.sql through 004_fixed_match_fields.sql");
  }

  async update(id: string, patch: Partial<Rule> & Partial<PostgresRuleInput>, email?: string): Promise<Rule | null> {
    if ("item" in patch || "item_name" in patch) throw new Error("item and item_name are generated and cannot be updated directly");
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const found = await client.query(`SELECT * FROM ${this.table("rules")} WHERE namespace=$1 AND id=$2 AND archived_at IS NULL FOR UPDATE`, [this.namespace,id]);
      if (!found.rowCount) { await client.query("ROLLBACK"); return null; }
      const values: unknown[] = [this.namespace,id,email ?? null];
      const sets = ["updated_at=now()","updated_by_email=$3"];
      const columns: Record<string,string> = { title:"title",summary:"summary",description:"description",raw_description:"raw_description",status:"status",tags:"tags",conditions:"conditions",actions:"actions",cycle:"cycle",references:"reference_names" };
      for (const [key,column] of Object.entries(columns)) {
        const value = (patch as any)[key];
        if (value === undefined) continue;
        if (["title","cycle"].includes(key)) {
          values.push(matchValue(value,key));
          sets.push(`${column}=$${values.length}`);
        } else {
          const json = ["tags","conditions","actions","references"].includes(key);
          values.push(json ? JSON.stringify(key === "references" ? [...new Set(value)] : value) : value);
          sets.push(`${column}=$${values.length}${json ? "::jsonb" : ""}`);
        }
      }
      const patchValues = patch as Record<string, unknown>;
      for (const key of ["customer", "facility"] as const) {
        if (![key, `${key}_scope`, `${key}_id`, `${key}_name`].some(field => Object.prototype.hasOwnProperty.call(patchValues, field))) continue;
        const party = partyFromInput(patchValues, key, partyFromRow(found.rows[0], key));
        for (const [column, value] of [[`${key}_scope`, party.scope], [`${key}_id`, party.id], [`${key}_name`, party.name]] as const) {
          values.push(value);
          sets.push(`${column}=$${values.length}`);
        }
      }
      await client.query(`UPDATE ${this.table("rules")} SET ${sets.join(",")} WHERE namespace=$1 AND id=$2`, values);
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
    return this.get(id);
  }

  async remove(id: string, email?: string): Promise<boolean> {
    const result = await this.pool.query(`UPDATE ${this.table("rules")} SET archived_at=now(),updated_at=now(),updated_by_email=$3 WHERE namespace=$1 AND id=$2 AND archived_at IS NULL`, [this.namespace,id,email ?? null]);
    return result.rowCount === 1;
  }

  async restore(id: string, email?: string): Promise<boolean> {
    const result = await this.pool.query(`UPDATE ${this.table("rules")} SET archived_at=NULL,updated_at=now(),updated_by_email=$3 WHERE namespace=$1 AND id=$2 AND archived_at IS NOT NULL`, [this.namespace,id,email ?? null]);
    return result.rowCount === 1;
  }

  async addReference(name: string, content: string): Promise<void> {
    await this.pool.query(`INSERT INTO ${this.table("reference_documents")} (namespace,name,content) VALUES ($1,$2,$3) ON CONFLICT (namespace,name) DO UPDATE SET content=excluded.content`, [this.namespace,name,content]);
  }

  async getReference(name: string): Promise<string | null> {
    const result = await this.pool.query(`SELECT content FROM ${this.table("reference_documents")} WHERE namespace=$1 AND name=$2`, [this.namespace,name]);
    return result.rows[0]?.content ?? null;
  }
}

export function matchesDimensions(required: RuleDimensions, context: RuleDimensions): boolean {
  if (context.item !== undefined && !equalValues(required.item, context.item)) return false;
  for (const key of ["customer", "facility"] as const) {
    const scope = required[`${key}_scope`] ?? (required[key] === undefined || equalValues(required[key], "all") ? "all" : "specific");
    if (scope === "all") continue;
    const id = required[`${key}_id`];
    const name = required[`${key}_name`];
    const contextId = context[`${key}_id`];
    const contextName = context[`${key}_name`];
    const legacy = context[key];
    if (contextId === undefined && contextName === undefined && legacy === undefined) {
      if (context.item !== undefined) continue; // Exact item lookup can omit scope context.
      return false;
    }
    if (id !== undefined && contextId !== undefined) {
      if (!equalValues(id, contextId)) return false;
      continue;
    }
    if (name !== undefined && contextName !== undefined) {
      if (!equalValues(name, contextName)) return false;
      continue;
    }
    if (legacy !== undefined && [id, name, required[key]].some(value => equalValues(value, legacy))) continue;
    return false;
  }
  const cycle = required.cycle;
  if (cycle !== undefined && !equalValues(cycle, "all")) {
    if (context.cycle === undefined) return context.item !== undefined;
    if (!equalValues(cycle, context.cycle)) return false;
  }
  return true;
}

function specificity(dimensions: RuleDimensions | undefined): number {
  return ["customer_scope", "facility_scope", "cycle"].filter(key => dimensions?.[key] !== "all").length;
}

function equalValues(a: string | string[] | undefined, b: string | string[] | undefined): boolean {
  if (a === undefined || b === undefined) return false;
  const left = Array.isArray(a) ? a : [a];
  const right = Array.isArray(b) ? b : [b];
  return left.some(value => right.includes(value));
}
