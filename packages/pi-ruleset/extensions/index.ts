import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import * as fs from "fs";
import * as path from "path";
import * as https from "https";
import * as http from "http";
import { PostgresRuleStore, matchesDimensions, type PostgresConfig, type RuleDimensions } from "./postgres";
// @ts-ignore — no bundled types for wink-bm25-text-search
import bm25 from "wink-bm25-text-search";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Rule {
  id: string;
  title: string;
  item_name?: string;
  status: "active" | "inactive";
  priority: "high" | "medium" | "low";
  tags: string[];
  summary: string;
  description: string;
  raw_description?: string;   // original user words, preserved verbatim
  dimensions?: RuleDimensions;
  created_by_email?: string;
  updated_by_email?: string;
  scope?: string[];            // customer IDs or groups this rule applies to; empty = all
  conditions: string[];
  actions: string[];
  references: string[];
  created: string;
  updated: string;
}

interface IndexEntry {
  id: string;
  title: string;
  status: "active" | "inactive";
  priority: "high" | "medium" | "low";
  tags: string[];
  summary: string;
  scope?: string[];
  file: string;
  updated: string;
}

interface SimilarityCandidate {
  entry: IndexEntry;
  score: number;
  reasons: string[];
}

function fixedMatchContext(params: { customer?: string; customer_id?: string; customer_name?: string; facility?: string; facility_id?: string; facility_name?: string; item?: string; cycle?: string; dimensions?: RuleDimensions }): RuleDimensions | undefined {
  const context: RuleDimensions = { ...(params.dimensions ?? {}) };
  for (const key of ["customer", "customer_id", "customer_name", "facility", "facility_id", "facility_name", "item", "cycle"] as const) {
    const value = params[key];
    if (value !== undefined) context[key] = value;
  }
  return Object.keys(context).length > 0 ? context : undefined;
}

function dimensionValue(value: unknown): string | undefined {
  if (Array.isArray(value)) return value.length === 1 ? String(value[0]) : undefined;
  return typeof value === "string" ? value : undefined;
}

function partyLabel(dimensions: RuleDimensions | undefined, key: "customer" | "facility"): string {
  if (!dimensions || dimensions[`${key}_scope`] === "all") return "all";
  const id = dimensionValue(dimensions[`${key}_id`]);
  const name = dimensionValue(dimensions[`${key}_name`]);
  return [id && `id=${id}`, name && `name=${name}`].filter(Boolean).join(", ") || dimensionValue(dimensions[key]) || "all";
}

// ---------------------------------------------------------------------------
// Two-level path resolution
// ---------------------------------------------------------------------------

type RulesetMode = "both" | "project-only" | "global-only";

interface UserContextConfig {
  api_base: string;
}

interface UserInfo {
  id: string;
  name: string;
  [key: string]: unknown;
}

interface RulesetConfig {
  mode: RulesetMode;
  user_context?: UserContextConfig;
  storage?: "markdown" | "postgres";
  postgres?: PostgresConfig;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function deepMergeJson<T extends Record<string, unknown>>(base: T, override: Record<string, unknown>): T {
  const result: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(override)) {
    if (["__proto__", "prototype", "constructor"].includes(key)) continue;
    const current = result[key];
    result[key] = isPlainObject(current) && isPlainObject(value)
      ? deepMergeJson(current, value)
      : value;
  }
  return result as T;
}

function globalRulesDir(): string {
  const home = process.env.HOME ?? process.env.USERPROFILE ?? "~";
  return path.join(home, ".pi", "agent", "rules");
}

function projectRulesDir(cwd: string): string | null {
  // walk up from cwd looking for .git or .pi
  let dir = cwd;
  for (let i = 0; i < 10; i++) {
    if (
      fs.existsSync(path.join(dir, ".git")) ||
      fs.existsSync(path.join(dir, ".pi"))
    ) {
      return path.join(dir, ".pi", "rules");
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function readRulesetConfig(cwd: string): RulesetConfig {
  try {
      const home = process.env.HOME ?? process.env.USERPROFILE;
      const globalPath = home ? path.join(home, ".pi", "agent", "settings.json") : null;
      const projectPath = path.join(cwd, ".pi", "settings.json");
      const readConfig = (settingsPath: string | null): any =>
        settingsPath && fs.existsSync(settingsPath)
          ? JSON.parse(fs.readFileSync(settingsPath, "utf-8"))?.["pi-ruleset"]
          : undefined;
      const globalCfg = readConfig(globalPath);
      const projectCfg = readConfig(projectPath);
      const cfg = deepMergeJson(
        isPlainObject(globalCfg) ? globalCfg : {},
        isPlainObject(projectCfg) ? projectCfg : {},
      ) as any;
      const mode = cfg.mode;
      const validMode: RulesetMode =
        mode === "project-only" || mode === "global-only" || mode === "both"
          ? mode
          : "both";

      const apiBase = cfg.user_context?.api_base;
      const user_context: UserContextConfig | undefined =
        apiBase
          ? { api_base: apiBase }
          : undefined;

      const configuredStorage = cfg.storage;
      const migration = cfg.postgres?.migration;
      if (configuredStorage && !["markdown", "postgres"].includes(configuredStorage)) throw new Error("Unknown storage backend");
      if (migration && migration !== "manual") throw new Error("Only manual migration is supported");
      const storage = configuredStorage === "postgres" ? "postgres" : "markdown";
      const postgres: PostgresConfig | undefined = storage === "postgres"
        ? {
            schema: cfg.postgres?.schema ?? "agent_ruleset",
            sslmode: cfg.postgres?.sslmode,
            ssl_ca_file: cfg.postgres?.ssl_ca_file,
          }
        : undefined;

      return { mode: validMode, user_context, storage, postgres };
  } catch (error) {
    throw new Error("Invalid pi-ruleset settings: " + (error as Error).message);
  }
}

interface ResolvedDirs {
  write: string;          // where ruleset_add writes to
  read: string[];         // ordered list to read from (project first)
  projectDir: string | null;
  globalDir: string;
}

function resolveRulesDirs(cwd: string, overrideDir?: string): ResolvedDirs {
  const globalDir = globalRulesDir();
  const projectDir = projectRulesDir(cwd);
  const config = readRulesetConfig(cwd);

  // explicit override from tool parameter — use as-is
  if (overrideDir) {
    const resolved = path.isAbsolute(overrideDir)
      ? overrideDir
      : path.join(cwd, overrideDir);
    return { write: resolved, read: [resolved], projectDir, globalDir };
  }

  const mode = config.mode;

  if (mode === "project-only") {
    const dir = projectDir ?? path.join(cwd, ".pi", "rules");
    return { write: dir, read: [dir], projectDir, globalDir };
  }

  if (mode === "global-only") {
    return { write: globalDir, read: [globalDir], projectDir, globalDir };
  }

  // "both" (default): project first for reads, project for writes (fall back to global)
  const writeDir = projectDir ?? globalDir;
  const readDirs = projectDir ? [projectDir, globalDir] : [globalDir];
  return { write: writeDir, read: readDirs, projectDir, globalDir };
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function dailyDir(baseDir: string, date: string): string {
  return path.join(baseDir, date);
}

function ruleFilePath(baseDir: string, date: string, id: string, slug: string): string {
  return path.join(dailyDir(baseDir, date), `${id}-${slug}.md`);
}

function indexPath(baseDir: string): string {
  return path.join(baseDir, "RULES.md");
}

function referencesDir(baseDir: string): string {
  return path.join(baseDir, "references");
}

function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
}

// ---------------------------------------------------------------------------
// Index read / write
// ---------------------------------------------------------------------------

function readIndex(baseDir: string): IndexEntry[] {
  const fp = indexPath(baseDir);
  if (!fs.existsSync(fp)) return [];
  const content = fs.readFileSync(fp, "utf-8");
  const entries: IndexEntry[] = [];
  for (const line of content.split("\n")) {
    // table row: | id | title | status | priority | tags | summary | scope | file | updated |
    if (!line.startsWith("|") || line.startsWith("| ID") || /^\|[-\s|]+$/.test(line)) continue;
    const cols = line.split("|").slice(1, -1).map((c) => c.trim());
    if (cols.length < 9) continue;
    entries.push({
      id: cols[0],
      title: cols[1],
      status: cols[2] as IndexEntry["status"],
      priority: cols[3] as IndexEntry["priority"],
      tags: cols[4].split(",").map((t) => t.trim()).filter(Boolean),
      summary: cols[5],
      scope: cols[6] ? cols[6].split(";").map((s) => s.trim()).filter(Boolean) : [],
      file: cols[7],
      updated: cols[8],
    });
  }
  return entries;
}

function writeIndex(baseDir: string, entries: IndexEntry[]): void {
  fs.mkdirSync(baseDir, { recursive: true });
  const header = [
    "# Ruleset Index",
    "",
    "| ID | Title | Status | Priority | Tags | Summary | Scope | File | Updated |",
    "|----|-------|--------|----------|------|---------|-------|------|---------|",
  ];
  const rows = entries.map(
    (e) =>
      `| ${e.id} | ${e.title} | ${e.status} | ${e.priority} | ${e.tags.join(", ")} | ${e.summary} | ${(e.scope ?? []).join("; ")} | ${e.file} | ${e.updated} |`
  );
  fs.writeFileSync(indexPath(baseDir), [...header, ...rows, ""].join("\n"), "utf-8");
}

function nextId(entries: IndexEntry[]): string {
  const nums = entries.map((e) => parseInt(e.id, 10)).filter((n) => !isNaN(n));
  const max = nums.length > 0 ? Math.max(...nums) : 0;
  return String(max + 1).padStart(3, "0");
}

// ---------------------------------------------------------------------------
// Rule file read / write
// ---------------------------------------------------------------------------

function serializeRule(rule: Rule): string {
  const lines: string[] = [
    `# ${rule.id}: ${rule.title}`,
    "",
    `- **Status:** ${rule.status}`,
    `- **Priority:** ${rule.priority}`,
    `- **Tags:** ${rule.tags.join(", ")}`,
    `- **Created:** ${rule.created}`,
    `- **Updated:** ${rule.updated}`,
  ];

  if (rule.scope && rule.scope.length > 0) {
    lines.push(`- **Scope:** ${rule.scope.join(", ")}`);
  }

  if (rule.dimensions) lines.push(`- **Dimensions:** ${JSON.stringify(rule.dimensions)}`);
  if (rule.item_name) lines.push(`- **Item name:** ${rule.item_name}`);
  if (rule.created_by_email) lines.push(`- **Created by:** ${rule.created_by_email}`);
  if (rule.updated_by_email) lines.push(`- **Updated by:** ${rule.updated_by_email}`);
  lines.push("", "## Summary", "", rule.summary, "");

  if (rule.raw_description) {
    lines.push("## Original Description", "", rule.raw_description, "");
  }

  lines.push("## Description", "", rule.description, "");

  lines.push("## Conditions", "");
  if (rule.conditions.length > 0) {
    lines.push(...rule.conditions.map((c) => `- ${c}`));
  } else {
    lines.push("- (pending — to be defined)");
  }
  lines.push("");

  lines.push("## Actions", "");
  if (rule.actions.length > 0) {
    lines.push(...rule.actions.map((a) => `- ${a}`));
  } else {
    lines.push("- (pending — to be defined)");
  }

  if (rule.references && rule.references.length > 0) {
    lines.push("", "## References", "");
    for (const ref of rule.references) {
      lines.push(`- ${ref}`);
    }
  }

  return lines.join("\n") + "\n";
}

function parseRuleFile(content: string): Partial<Rule> {
  const get = (pattern: RegExp) => content.match(pattern)?.[1]?.trim() ?? "";
  const getList = (section: string): string[] => {
    const m = content.match(new RegExp(`## ${section}\\n([\\s\\S]*?)(?=\\n## |$)`));
    if (!m) return [];
    return m[1]
      .split("\n")
      .map((l) => l.replace(/^-\s*/, "").trim())
      .filter((l) => l && l !== "(pending — to be defined)");
  };

  const titleLine = content.match(/^# (\S+): (.+)$/m);
  const scopeRaw = get(/\*\*Scope:\*\*\s*(.+)/);
  const rawDesc = getList("Original Description").join("\n");

  return {
    id: titleLine?.[1],
    title: titleLine?.[2]?.trim(),
    status: get(/\*\*Status:\*\*\s*(\w+)/) as Rule["status"],
    priority: get(/\*\*Priority:\*\*\s*(\w+)/) as Rule["priority"],
    tags: get(/\*\*Tags:\*\*\s*(.+)/).split(",").map((t) => t.trim()).filter(Boolean),
    created: get(/\*\*Created:\*\*\s*(.+)/),
    updated: get(/\*\*Updated:\*\*\s*(.+)/),
    scope: scopeRaw ? scopeRaw.split(",").map((s) => s.trim()).filter(Boolean) : [],
    summary: getList("Summary").join(" "),
    raw_description: rawDesc || undefined,
    description: getList("Description").join("\n"),
    conditions: getList("Conditions"),
    actions: getList("Actions"),
    references: getList("References"),
  };
}

function readRuleFile(filePath: string): Rule | null {
  if (!fs.existsSync(filePath)) return null;
  const content = fs.readFileSync(filePath, "utf-8");
  const partial = parseRuleFile(content);
  if (!partial.id || !partial.title) return null;
  return partial as Rule;
}

function writeRuleFile(filePath: string, rule: Rule): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, serializeRule(rule), "utf-8");
}

// ---------------------------------------------------------------------------
// BM25 helpers
// ---------------------------------------------------------------------------

// minimal prep pipeline: lowercase → split on non-alphanumeric → drop short tokens
function prepTokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .flatMap(w => /[\u3400-\u9fff]/.test(w) ? [...w] : [w]).filter(Boolean);
}

function tagOverlap(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const sa = new Set(a.map((t) => t.toLowerCase()));
  const sb = new Set(b.map((t) => t.toLowerCase()));
  const intersection = [...sa].filter((x) => sb.has(x));
  const union = new Set([...sa, ...sb]);
  return intersection.length / union.size;
}

// Build a fresh BM25 engine from the given index entries.
// Fields: title (weight 3), summary (weight 2), tags (weight 2).
// Returns a search function: (query) => Array<[id, score]>
function buildSimilarityEngine(
  entries: IndexEntry[]
): (query: string) => Array<[string, number]> {
  if (entries.length < 2) return query => entries.filter(entry => prepTokens(query).some(token => prepTokens(entry.title + " " + entry.summary).includes(token))).map(entry => [entry.id, 1]);

  const engine = bm25();
  engine.defineConfig({ fldWeights: { title: 3, summary: 2, tags: 2 } });
  engine.definePrepTasks([prepTokens]);

  for (const e of entries) {
    engine.addDoc(
      { title: e.title, summary: e.summary, tags: e.tags.join(" ") },
      e.id
    );
  }
  engine.consolidate();

  return (query: string) => engine.search(query) as Array<[string, number]>;
}

// Build a BM25 engine over full rule content for semantic retrieval.
// Fields: title (3), summary (2), description (2), conditions (1), actions (1), tags (2).
function buildSemanticEngine(
  rules: Rule[]
): (query: string, limit: number) => Array<[string, number]> {
  if (rules.length < 2) return (query, limit) => rules.filter(rule => prepTokens(query).some(token => prepTokens([rule.title, rule.summary, rule.description].join(" ")).includes(token))).slice(0, limit).map(rule => [rule.id, 1]);

  const engine = bm25();
  engine.defineConfig({
    fldWeights: { title: 3, summary: 2, description: 2, conditions: 1, actions: 1, tags: 2 },
  });
  engine.definePrepTasks([prepTokens]);

  for (const r of rules) {
    engine.addDoc(
      {
        title: r.title,
        summary: r.summary,
        description: r.description,
        conditions: r.conditions.join(" "),
        actions: r.actions.join(" "),
        tags: r.tags.join(" "),
      },
      r.id
    );
  }
  engine.consolidate();

  return (query: string, limit: number) =>
    engine.search(query, limit) as Array<[string, number]>;
}

const SIMILARITY_THRESHOLD = 0.5; // BM25 scores are not bounded; treat as a minimum signal floor

function findSimilarRules(
  newTitle: string,
  newSummary: string,
  newTags: string[],
  entries: IndexEntry[]
): SimilarityCandidate[] {
  if (entries.length === 0) return [];

  const search = buildSimilarityEngine(entries);
  const query = `${newTitle} ${newSummary} ${newTags.join(" ")}`;
  const results = search(query);

  const entryMap = new Map(entries.map((e) => [e.id, e]));

  return results
    .filter(([, score]) => score >= SIMILARITY_THRESHOLD)
    .slice(0, 3)
    .map(([id, score]) => {
      const entry = entryMap.get(id)!;
      const reasons: string[] = [`BM25 score ${score.toFixed(2)}`];
      const to = tagOverlap(newTags, entry.tags);
      if (to >= 0.5) reasons.push(`tag overlap ${Math.round(to * 100)}%`);
      return { entry, score, reasons };
    });
}

// ---------------------------------------------------------------------------
// User context helpers
// ---------------------------------------------------------------------------

function httpGet(url: string, token: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const transport = parsed.protocol === "https:" ? https : http;
    const req = transport.get(
      url,
      { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            resolve(data);
          } else {
            reject(new Error(`HTTP ${res.statusCode}`));
          }
        });
      }
    );
    req.on("error", reject);
    req.setTimeout(5000, () => { req.destroy(); reject(new Error("timeout")); });
  });
}

async function fetchUserInfo(config: UserContextConfig): Promise<UserInfo | null> {
  let token: string | undefined;

  try {
    const { execSync } = await import("child_process");
    const fromFile = execSync("cat /workspace/.pi-token 2>/dev/null", { timeout: 3000 })
      .toString()
      .trim();
    if (fromFile) token = fromFile;
  } catch {
    // 文件不存在或读取失败
  }

  if (!token) return null;

  try {
    const base = config.api_base.replace(/\/$/, "");
    const raw = await httpGet(`${base}/api/v1/auth/me`, token);
    const data = JSON.parse(raw);
    if (data?.data?.id) return data.data as UserInfo;
    if (data?.id) return data as UserInfo;
    return null;
  } catch {
    return null;
  }
}

function buildUserContextBlock(user: UserInfo): string {
  const lines = [
    "## Current User",
    "",
    `- id: ${user.id}`,
    `- name: ${user.name}`,
  ];

  for (const [key, value] of Object.entries(user)) {
    if (key === "id" || key === "name") continue;
    if (Array.isArray(value)) {
      lines.push(`- ${key}: ${value.join(", ")}`);
    } else if (value !== null && value !== undefined) {
      lines.push(`- ${key}: ${value}`);
    }
  }

  return lines.join("\n");
}


export default function (pi: ExtensionAPI) {
  const FULL_INJECT_THRESHOLD = 10;
  const priorityOrder: Record<string, number> = { high: 0, medium: 1, low: 2 };
  const postgresStores = new Map<string, PostgresRuleStore>();

  async function getPostgresStore(cwd: string): Promise<PostgresRuleStore | null> {
    const config = readRulesetConfig(cwd);
    if (config.storage !== "postgres" || !config.postgres) return null;
    const key = `${process.env.DB_HOST}:${process.env.DB_PORT}:${process.env.DB_USER}:${process.env.DB_NAME}:${config.postgres.schema}:${process.env.AGENT_NAME}:${config.postgres.sslmode ?? process.env.PGSSLMODE ?? "disable"}:${config.postgres.ssl_ca_file ?? ""}`;
    const existing = postgresStores.get(key);
    if (existing) return existing;
    const store = new PostgresRuleStore(config.postgres);
    try { await store.checkSchema(); } catch (error) { await store.close(); throw error; }
    postgresStores.set(key, store);
    return store;
  }

  pi.on("session_shutdown", async () => {
    await Promise.all([...postgresStores.values()].map(store => store.close()));
    postgresStores.clear();
  });

  async function actor(cwd: string): Promise<string | undefined> {
    const config = readRulesetConfig(cwd);
    const user = config.user_context ? await fetchUserInfo(config.user_context) : null;
    return typeof user?.email === "string" ? user.email : undefined;
  }

  // Merge entries from multiple dirs — project entries override global entries with same ID.
  function mergeEntries(dirs: string[]): Array<IndexEntry & { sourceDir: string }> {
    const seen = new Map<string, IndexEntry & { sourceDir: string }>();
    // dirs are ordered project-first; first occurrence wins (project overrides global)
    for (const dir of dirs) {
      for (const entry of readIndex(dir)) {
        if (!seen.has(entry.id)) {
          seen.set(entry.id, { ...entry, sourceDir: dir });
        }
      }
    }
    return Array.from(seen.values());
  }

  // Find which dir an entry lives in.
  function findEntryDir(id: string, dirs: string[]): string | null {
    for (const dir of dirs) {
      const entries = readIndex(dir);
      if (entries.find((e) => e.id === id)) return dir;
    }
    return null;
  }

  // Build the rules block injected into every agent turn.
  async function buildRulesBlock(cwd: string): Promise<string | null> {
    const postgres = await getPostgresStore(cwd);
    if (postgres) {
      const rules = await postgres.list("active");
      if (rules.length === 0) return null;
      const sorted = [...rules].sort(
        (a, b) => (priorityOrder[a.priority] ?? 9) - (priorityOrder[b.priority] ?? 9)
      );

      if (sorted.length < FULL_INJECT_THRESHOLD) {
        const blocks: string[] = [
          "## Active Business Rules",
          "",
          "Apply only rules whose customer, facility, and cycle fields match the task. The value all matches every task. Item is a generated rule identifier, not a business matching field. More specific rules sort first. Report conflicting rules rather than silently overriding them.",
          "",
        ];
        for (const rule of sorted) {
          blocks.push(serializeRule(rule));
          blocks.push("---");
        }
        return blocks.join("\n");
      }

      return [
        "## Active Business Rules (index)",
        "",
        `${sorted.length} rules active. Use \`ruleset_get\` with a semantic query to load relevant rules before applying them.`,
        "Rules apply only when customer, facility, and cycle match the task; all matches every value. Item identifies a rule and may be used for exact lookup.",
        "",
        "| ID | Title | Item name | Customer | Facility | Item | Cycle | Summary |",
        "|----|-------|-----------|----------|----------|------|-------|---------|",
        ...sorted.map(
          (rule) =>
            `| ${rule.id} | ${rule.title} | ${rule.item_name} | ${partyLabel(rule.dimensions, "customer")} | ${partyLabel(rule.dimensions, "facility")} | ${rule.dimensions?.item} | ${rule.dimensions?.cycle} | ${rule.summary} |`
        ),
        "",
      ].join("\n");
    }

    const { read } = resolveRulesDirs(cwd);
    const entries = mergeEntries(read).filter((e) => e.status === "active");
    if (entries.length === 0) return null;

    const sorted = [...entries].sort(
      (a, b) => (priorityOrder[a.priority] ?? 9) - (priorityOrder[b.priority] ?? 9)
    );

    if (sorted.length < FULL_INJECT_THRESHOLD) {
      const blocks: string[] = [
        "## Active Business Rules",
        "",
        "Apply these rules to every relevant task. Rules are ordered high → medium → low priority.",
        "",
      ];
      for (const entry of sorted) {
        const rule = readRuleFile(path.join(entry.sourceDir, entry.file));
        if (!rule) continue;
        blocks.push(serializeRule(rule));
        blocks.push("---");
      }
      return blocks.join("\n");
    }

    // index-only mode
    const lines = [
      "## Active Business Rules (index)",
      "",
      `${sorted.length} rules active. Use \`ruleset_get\` with a semantic query to load relevant rules before applying them.`,
      "Rules with a Scope column only apply to the listed customers.",
      "",
      "| ID | Title | Priority | Tags | Scope | Summary |",
      "|----|-------|----------|------|-------|---------|",
      ...sorted.map(
        (e) =>
          `| ${e.id} | ${e.title} | ${e.priority} | ${e.tags.join(", ")} | ${(e.scope ?? []).join(", ") || "all"} | ${e.summary} |`
      ),
      "",
    ];
    return lines.join("\n");
  }

  // Marker injected at the start of every rules block so context event can detect it.
  const RULES_MARKER = "<!-- pi-ruleset -->";

  async function buildRulesBlockMarked(cwd: string): Promise<string | null> {
    const block = await buildRulesBlock(cwd);
    if (!block) return null;
    return RULES_MARKER + "\n" + block;
  }

  function messagesHaveRules(messages: { role: string; content: unknown }[]): boolean {
    return messages.some(
      (m) =>
        typeof m.content === "string" &&
        m.content.includes(RULES_MARKER)
    );
  }

  pi.on("before_agent_start", async (event, ctx) => {
    const config = readRulesetConfig(ctx.cwd);

    let extra = "";

    if (config.user_context) {
      const user = await fetchUserInfo(config.user_context);
      if (user) {
        extra = "\n\n" + buildUserContextBlock(user);
      }
    }

    const block = await buildRulesBlockMarked(ctx.cwd);
    if (!block && !extra) return;

    const append = (block ? "\n\n" + block : "") + extra;
    return { systemPrompt: event.systemPrompt + append };
  });

  // context fires before every provider request.
  // Only inject if rules are not already present — prevents double-injection on normal turns.
  // After compaction the marker disappears from messages, so this re-injects automatically.
  pi.on("context", async (event, ctx) => {
    if (messagesHaveRules(event.messages as { role: string; content: unknown }[])) return;
    const block = await buildRulesBlockMarked(ctx.cwd);
    if (!block) return;
    return { messages: [...event.messages, { role: "user" as const, content: block, timestamp: Date.now() }] };
  });

  pi.on("session_start", async (_event, ctx) => {
    const postgres = await getPostgresStore(ctx.cwd);
    if (postgres) {
      await postgres.checkSchema();
      const entries = await postgres.list("active");
      if (entries.length === 0) {
        ctx.ui.notify("pi-ruleset: no rules found — run the database migration or use ruleset_add", "info");
        return;
      }
      ctx.ui.notify(`pi-ruleset: ${entries.length} active rule${entries.length > 1 ? "s" : ""} loaded (postgres)`, "info");
      return;
    }

    const { read, projectDir, globalDir } = resolveRulesDirs(ctx.cwd);
    const entries = mergeEntries(read).filter((e) => e.status === "active");

    if (entries.length === 0) {
      const config = readRulesetConfig(ctx.cwd);
      if (config.mode !== "global-only" && projectDir) {
        ctx.ui.notify("pi-ruleset: no rules found — use ruleset_add to create your first rule", "info");
      } else {
        ctx.ui.notify("pi-ruleset: no rules found — use ruleset_add to create your first rule", "info");
      }
      return;
    }

    const projectCount = projectDir ? readIndex(projectDir).filter((e) => e.status === "active").length : 0;
    const globalCount = readIndex(globalDir).filter((e) => e.status === "active").length;
    const parts: string[] = [];
    if (projectCount > 0) parts.push(`${projectCount} project`);
    if (globalCount > 0) parts.push(`${globalCount} global`);
    ctx.ui.notify(`pi-ruleset: ${entries.length} active rule${entries.length > 1 ? "s" : ""} loaded (${parts.join(", ")})`, "info");
  });

  // -------------------------------------------------------------------------
  // ruleset_add
  // -------------------------------------------------------------------------
  pi.registerTool({
    name: "ruleset_add",
    label: "Add Rule",
    description:
      "Add a new business rule. Checks for similar existing rules before writing. Writes to project (.pi/rules/) by default, or global (~/.pi/agent/rules/) if no project is detected.",
    parameters: Type.Object({
      title: Type.String({ minLength: 1, description: "Short title for the rule; PostgreSQL generates item_name from this title" }),
      summary: Type.String({ description: "One-sentence summary shown in the index" }),
      description: Type.String({ description: "Full description of what this rule governs" }),
      raw_description: Type.Optional(Type.String({
        description: "Original user words describing the rule — paste verbatim, preserved as-is",
      })),
      conditions: Type.Array(Type.String(), { default: [], description: "Conditions that trigger this rule (can be empty if not yet known)" }),
      actions: Type.Array(Type.String(), { default: [], description: "Actions to take when conditions are met (can be empty if not yet known)" }),
      priority: Type.Union(
        [Type.Literal("high"), Type.Literal("medium"), Type.Literal("low")],
        { default: "medium" }
      ),
      tags: Type.Array(Type.String(), { default: [] }),
      customer: Type.Optional(Type.String({ description: "Legacy customer name shorthand; use customer_id/customer_name for PostgreSQL" })),
      facility: Type.Optional(Type.String({ description: "Legacy facility name shorthand; use facility_id/facility_name for PostgreSQL" })),
      customer_scope: Type.Optional(Type.Union([Type.Literal("all"), Type.Literal("specific")])),
      customer_id: Type.Optional(Type.String({ minLength: 1, description: "Stable customer ID for a specific customer" })),
      customer_name: Type.Optional(Type.String({ minLength: 1, description: "Customer name for a specific customer" })),
      facility_scope: Type.Optional(Type.Union([Type.Literal("all"), Type.Literal("specific")])),
      facility_id: Type.Optional(Type.String({ minLength: 1, description: "Stable facility ID for a specific facility" })),
      facility_name: Type.Optional(Type.String({ minLength: 1, description: "Facility name for a specific facility" })),
      cycle: Type.Optional(Type.String({ description: "Cycle or period identifier; omit for all cycles" })),
      scope: Type.Optional(Type.Array(Type.String(), {
        description: "Customer IDs or names this rule applies to. Empty or omit = applies to all customers.",
      })),
      dimensions: Type.Optional(Type.Record(
        Type.String(),
        Type.Union([Type.String(), Type.Array(Type.String())]),
        { description: "Legacy compatibility for customer, facility, and cycle. PostgreSQL generates item and item_name; do not include either here." }
      )),
      references: Type.Array(Type.String(), {
        default: [],
        description: "Markdown file paths under references/ (e.g. pricing-policy.md)",
      }),
      rules_dir: Type.Optional(Type.String({ description: "Override base directory for rules" })),
      target: Type.Optional(Type.Union(
        [Type.Literal("project"), Type.Literal("global")],
        { description: "Force write to project or global dir (overrides mode config)" }
      )),
      force: Type.Optional(
        Type.Boolean({ description: "Skip similarity check and force-add as new rule", default: false })
      ),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const postgres = await getPostgresStore(ctx.cwd);
      if (postgres) {
        if (params.rules_dir || params.target) throw new Error("PostgreSQL uses configured namespace; rules_dir/target are Markdown-only");
        if ("item" in params || "item_name" in params || (params.dimensions && ("item" in params.dimensions || "item_name" in params.dimensions))) {
          throw new Error("item and item_name are generated by PostgreSQL rules and cannot be supplied");
        }
        const existingRules = await postgres.list("active");
        if (!params.force) {
          const candidates = findSimilarRules(
            params.title,
            params.summary,
            params.tags ?? [],
            existingRules.map((rule) => ({
              id: rule.id,
              title: rule.title,
              status: rule.status,
              priority: rule.priority,
              tags: rule.tags,
              summary: rule.summary,
              scope: rule.scope,
              file: "",
              updated: rule.updated,
            }))
          );
          if (candidates.length > 0) {
            return { details: {}, content: [{
                type: "text",
                text: [
                  "Similar rules already exist. Please review before deciding:",
                  "",
                  candidates.map((c) =>
                    `- [${c.entry.id}] \"${c.entry.title}\" (score ${Math.round(c.score * 100)}%) — ${c.reasons.join(", ")}\n  Summary: ${c.entry.summary}`
                  ).join("\n"),
                  "",
                  "Call `ruleset_add` again with `force: true` to add a separate rule.",
                ].join("\n"),
              }],
            };
          }
        }

        const fixed = (params.dimensions ?? {}) as RuleDimensions;
        const user = readRulesetConfig(ctx.cwd).user_context
          ? await fetchUserInfo(readRulesetConfig(ctx.cwd).user_context!)
          : null;
        const rule = await postgres.add({
          title: params.title,
          summary: params.summary,
          description: params.description,
          raw_description: params.raw_description,
          conditions: params.conditions ?? [],
          actions: params.actions ?? [],
          tags: params.tags ?? [],
          customer: params.customer ?? dimensionValue(fixed.customer),
          customer_scope: params.customer_scope,
          customer_id: params.customer_id,
          customer_name: params.customer_name,
          facility: params.facility ?? dimensionValue(fixed.facility),
          facility_scope: params.facility_scope,
          facility_id: params.facility_id,
          facility_name: params.facility_name,
          cycle: params.cycle ?? dimensionValue(fixed.cycle) ?? "all",
          references: params.references ?? [],
          created_by_email: user && typeof user.email === "string" ? user.email : undefined,
        });
        return { details: {}, content: [{ type: "text", text: `Rule added: ${rule.id} — ${rule.title}` }] };
      }

      if (params.dimensions && Object.keys(params.dimensions).length) throw new Error("Dynamic dimensions require PostgreSQL storage");
      const dirs = resolveRulesDirs(ctx.cwd, params.rules_dir);

      // target override
      let writeDir = dirs.write;
      if (params.target === "global") writeDir = dirs.globalDir;
      if (params.target === "project") writeDir = dirs.projectDir ?? dirs.globalDir;

      const { read } = dirs;
      const allEntries = mergeEntries(read);

      if (!params.force) {
        const candidates = findSimilarRules(
          params.title,
          params.summary,
          params.tags ?? [],
          allEntries
        );
        if (candidates.length > 0) {
          const list = candidates
            .map(
              (c) =>
                `- [${c.entry.id}] "${c.entry.title}" (score ${Math.round(c.score * 100)}%) — ${c.reasons.join(", ")}\n  Summary: ${c.entry.summary}`
            )
            .join("\n");
          return { details: {}, content: [{
              type: "text",
              text: [
                "Similar rules already exist. Please review before deciding:",
                "",
                list,
                "",
                "Options:",
                "1. Call `ruleset_update` with the existing rule ID to update it",
                "2. Call `ruleset_add` again with `force: true` to add as a new separate rule",
                "",
                "Layer 2 — ask the user or reason: does the new rule cover a meaningfully different scenario?",
              ].join("\n"),
            }],
          };
        }
      }

      const today = todayStr();
      // ID is global across both dirs to avoid collisions
      const id = nextId(allEntries);
      const slug = slugify(params.title);
      const filePath = ruleFilePath(writeDir, today, id, slug);
      const relPath = path.relative(writeDir, filePath);

      const rule: Rule = {
        id,
        title: params.title,
        status: "active",
        priority: params.priority ?? "medium",
        tags: params.tags ?? [],
        summary: params.summary,
        description: params.description,
        raw_description: params.raw_description,
        scope: params.scope ?? [],
        conditions: params.conditions ?? [],
        actions: params.actions ?? [],
        references: (params.references ?? []).map((r) =>
          r.startsWith("[") ? r : `[${path.basename(r, ".md")}](../references/${r})`
        ),
        created: today,
        updated: today,
      };

      writeRuleFile(filePath, rule);

      const writeEntries = readIndex(writeDir);
      writeEntries.push({
        id,
        title: params.title,
        status: "active",
        priority: params.priority ?? "medium",
        tags: params.tags ?? [],
        summary: params.summary,
        scope: params.scope ?? [],
        file: relPath,
        updated: today,
      });
      writeIndex(writeDir, writeEntries);

      const location = writeDir === dirs.globalDir ? "global" : "project";
      return { details: {}, content: [{ type: "text", text: `Rule added: ${id} — ${params.title}` }],
      };
    },
  });

  // -------------------------------------------------------------------------
  // ruleset_update
  // -------------------------------------------------------------------------
  pi.registerTool({
    name: "ruleset_update",
    label: "Update Rule",
    description: "Update fields of an existing rule by ID. Searches both project and global dirs.",
    parameters: Type.Object({
      id: Type.String({ description: "Rule ID to update (e.g. 001)" }),
      title: Type.Optional(Type.String({ minLength: 1, description: "Updated title; PostgreSQL updates generated item_name automatically" })),
      summary: Type.Optional(Type.String()),
      description: Type.Optional(Type.String()),
      raw_description: Type.Optional(Type.String()),
      conditions: Type.Optional(Type.Array(Type.String())),
      actions: Type.Optional(Type.Array(Type.String())),
      priority: Type.Optional(Type.Union([Type.Literal("high"), Type.Literal("medium"), Type.Literal("low")])),
      status: Type.Optional(Type.Union([Type.Literal("active"), Type.Literal("inactive")])),
      tags: Type.Optional(Type.Array(Type.String())),
      customer: Type.Optional(Type.String()),
      facility: Type.Optional(Type.String()),
      customer_scope: Type.Optional(Type.Union([Type.Literal("all"), Type.Literal("specific")])),
      customer_id: Type.Optional(Type.String({ minLength: 1 })),
      customer_name: Type.Optional(Type.String({ minLength: 1 })),
      facility_scope: Type.Optional(Type.Union([Type.Literal("all"), Type.Literal("specific")])),
      facility_id: Type.Optional(Type.String({ minLength: 1 })),
      facility_name: Type.Optional(Type.String({ minLength: 1 })),
      cycle: Type.Optional(Type.String()),
      dimensions: Type.Optional(Type.Record(Type.String(), Type.Union([Type.String(), Type.Array(Type.String())]))),
      scope: Type.Optional(Type.Array(Type.String())),
      references: Type.Optional(Type.Array(Type.String())),
      rules_dir: Type.Optional(Type.String()),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const postgres = await getPostgresStore(ctx.cwd);
      if (postgres) {
        if (params.rules_dir) throw new Error("PostgreSQL uses configured namespace; rules_dir/target are Markdown-only");
        if ("item" in params || "item_name" in params || (params.dimensions && ("item" in params.dimensions || "item_name" in params.dimensions))) {
          throw new Error("item and item_name are generated by PostgreSQL rules and cannot be updated directly");
        }
        const rule = await postgres.update(params.id, params, await actor(ctx.cwd));
        return { details: {}, content: [{type: "text", text: rule ? `Rule updated: ${rule.id} — ${rule.title}` : `Rule not found: ${params.id}`}], isError: !rule };
      }

      if (params.dimensions) throw new Error("Dynamic dimensions require PostgreSQL storage");
      const { read } = resolveRulesDirs(ctx.cwd, params.rules_dir);
      const sourceDir = findEntryDir(params.id, read);
      if (!sourceDir) {
        return { details: {}, content: [{ type: "text", text: `Rule not found: ${params.id}` }], isError: true };
      }

      const entries = readIndex(sourceDir);
      const entry = entries.find((e) => e.id === params.id)!;
      const fullPath = path.join(sourceDir, entry.file);
      const rule = readRuleFile(fullPath);
      if (!rule) {
        return { details: {}, content: [{ type: "text", text: `Rule file missing: ${entry.file}` }], isError: true };
      }

      if (params.title !== undefined) rule.title = params.title;
      if (params.summary !== undefined) rule.summary = params.summary;
      if (params.description !== undefined) rule.description = params.description;
      if (params.raw_description !== undefined) rule.raw_description = params.raw_description;
      if (params.conditions !== undefined) rule.conditions = params.conditions;
      if (params.actions !== undefined) rule.actions = params.actions;
      if (params.priority !== undefined) rule.priority = params.priority;
      if (params.status !== undefined) rule.status = params.status;
      if (params.tags !== undefined) rule.tags = params.tags;
      if (params.scope !== undefined) rule.scope = params.scope;
      if (params.references !== undefined) {
        rule.references = params.references.map((r) =>
          r.startsWith("[") ? r : `[${path.basename(r, ".md")}](../references/${r})`
        );
      }
      rule.updated = todayStr();

      writeRuleFile(fullPath, rule);

      entry.title = rule.title;
      entry.summary = rule.summary;
      entry.status = rule.status;
      entry.priority = rule.priority;
      entry.tags = rule.tags;
      entry.scope = rule.scope ?? [];
      entry.updated = rule.updated;
      writeIndex(sourceDir, entries);

      return { details: {}, content: [{ type: "text", text: `Rule updated: ${rule.id} — ${rule.title}` }] };
    },
  });

  // -------------------------------------------------------------------------
  // ruleset_remove
  // -------------------------------------------------------------------------
  pi.registerTool({
    name: "ruleset_remove",
    label: "Remove Rule",
    description: "Archive a rule by ID. Searches both project and global dirs.",
    parameters: Type.Object({
      id: Type.String({ description: "Rule ID to remove" }),
      rules_dir: Type.Optional(Type.String()),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const postgres = await getPostgresStore(ctx.cwd);
      if (postgres) {
        if (params.rules_dir) throw new Error("PostgreSQL uses configured namespace; rules_dir/target are Markdown-only");
        const removed = await postgres.remove(params.id, await actor(ctx.cwd));
        return { details: {}, content: [{type: "text", text: removed ? `Rule removed: ${params.id} (archived)` : `Rule not found: ${params.id}`}], isError: !removed };
      }

      const { read } = resolveRulesDirs(ctx.cwd, params.rules_dir);
      const sourceDir = findEntryDir(params.id, read);
      if (!sourceDir) {
        return { details: {}, content: [{ type: "text", text: `Rule not found: ${params.id}` }], isError: true };
      }

      const entries = readIndex(sourceDir);
      const idx = entries.findIndex((e) => e.id === params.id);
      const entry = entries[idx];
      const fullPath = path.join(sourceDir, entry.file);

      if (fs.existsSync(fullPath)) {
        const archiveDir = path.join(path.dirname(fullPath), ".archive");
        fs.mkdirSync(archiveDir, { recursive: true });
        fs.renameSync(fullPath, path.join(archiveDir, path.basename(fullPath)));
      }

      entries.splice(idx, 1);
      writeIndex(sourceDir, entries);

      return { details: {}, content: [{ type: "text", text: `Rule removed: ${entry.id} — ${entry.title} (archived)` }] };
    },
  });

  // -------------------------------------------------------------------------
  // ruleset_list
  // -------------------------------------------------------------------------
  pi.registerTool({
    name: "ruleset_list",
    label: "List Rules",
    description: "List all rules from both project and global dirs",
    parameters: Type.Object({
      dimensions: Type.Optional(Type.Record(Type.String(), Type.Union([Type.String(), Type.Array(Type.String())]))),
      customer: Type.Optional(Type.String()),
      facility: Type.Optional(Type.String()),
      customer_id: Type.Optional(Type.String()),
      customer_name: Type.Optional(Type.String()),
      facility_id: Type.Optional(Type.String()),
      facility_name: Type.Optional(Type.String()),
      item: Type.Optional(Type.String({ description: "Generated item UUID for exact lookup only" })),
      cycle: Type.Optional(Type.String()),
      status: Type.Optional(
        Type.Union([Type.Literal("active"), Type.Literal("inactive"), Type.Literal("all")], { default: "all" })
      ),
      rules_dir: Type.Optional(Type.String()),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const postgres = await getPostgresStore(ctx.cwd);
      if (postgres) {
        if (params.rules_dir) throw new Error("PostgreSQL uses configured namespace; rules_dir/target are Markdown-only");
        const filter = params.status === "all" ? undefined : params.status ?? undefined;
        const rules = await postgres.list(filter, fixedMatchContext(params));
        if (rules.length === 0) {
          return { details: {}, content: [{ type: "text", text: "No rules found." }] };
        }
        const lines = rules.map(
          (rule) =>
            `[${rule.id}] ${rule.title} | ${rule.status} | item_name: ${rule.item_name} | customer: ${partyLabel(rule.dimensions, "customer")} | facility: ${partyLabel(rule.dimensions, "facility")} | item: ${rule.dimensions?.item} | cycle: ${rule.dimensions?.cycle}\n    ${rule.summary}`
        );
        return { details: {}, content: [{ type: "text", text: lines.join("\n") }] };
      }

      if (params.dimensions) throw new Error("Dynamic dimensions require PostgreSQL storage");
      const { read } = resolveRulesDirs(ctx.cwd, params.rules_dir);
      const filter = params.status ?? "all";
      const entries = mergeEntries(read).filter((e) => filter === "all" || e.status === filter);

      if (entries.length === 0) {
        return { details: {}, content: [{ type: "text", text: "No rules found." }] };
      }

      const sorted = [...entries].sort(
        (a, b) => (priorityOrder[a.priority] ?? 9) - (priorityOrder[b.priority] ?? 9)
      );

      const lines = sorted.map(
        (e) =>
          `[${e.id}] ${e.title} | ${e.status} | ${e.priority} | scope: ${(e.scope ?? []).join(", ") || "all"}\n    ${e.summary}`
      );

      return { details: {}, content: [{ type: "text", text: lines.join("\n") }] };
    },
  });

  // -------------------------------------------------------------------------
  // ruleset_get
  // -------------------------------------------------------------------------
  pi.registerTool({
    name: "ruleset_get",
    label: "Get Rules",
    description: "Retrieve full rule content by ID or semantic query. Searches both project and global dirs.",
    parameters: Type.Object({
      dimensions: Type.Optional(Type.Record(Type.String(), Type.Union([Type.String(), Type.Array(Type.String())]))),
      customer: Type.Optional(Type.String()),
      facility: Type.Optional(Type.String()),
      customer_id: Type.Optional(Type.String()),
      customer_name: Type.Optional(Type.String()),
      facility_id: Type.Optional(Type.String()),
      facility_name: Type.Optional(Type.String()),
      item: Type.Optional(Type.String({ description: "Generated item UUID for exact lookup only" })),
      cycle: Type.Optional(Type.String()),
      id: Type.Optional(Type.String({ description: "Exact rule ID (e.g. 001)" })),
      query: Type.Optional(Type.String({ description: "Natural language query to find relevant rules" })),
      top_k: Type.Optional(Type.Integer({ default: 3, minimum: 1, maximum: 100 })),
      rules_dir: Type.Optional(Type.String()),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const postgres = await getPostgresStore(ctx.cwd);
      if (postgres) {
        if (params.rules_dir) throw new Error("PostgreSQL uses configured namespace; rules_dir/target are Markdown-only");
        if (params.id) {
          const rule = await postgres.get(params.id);
          const context = fixedMatchContext(params);
          if (!rule || (context && !matchesDimensions(rule.dimensions ?? {}, context))) {
            return { details: {}, content: [{ type: "text", text: `Rule not found: ${params.id}` }], isError: true };
          }
          return { details: {}, content: [{ type: "text", text: serializeRule(rule) }] };
        }

        if (params.query) {
          const topK = params.top_k ?? 3;
          const activeRules = await postgres.list("active", fixedMatchContext(params));
          if (activeRules.length === 0) {
            return { details: {}, content: [{ type: "text", text: "No active rules found." }] };
          }
          const search = buildSemanticEngine(activeRules);
          const results = search(params.query, topK);
          if (results.length === 0) {
            return { details: {}, content: [{ type: "text", text: "No matching rules found for query." }] };
          }
          const ruleMap = new Map(activeRules.map((rule) => [rule.id, rule]));
          const blocks = results
            .map(([id, score]) => {
              const rule = ruleMap.get(id);
              if (!rule) return null;
              return `<!-- relevance score: ${score.toFixed(3)} -->\n${serializeRule(rule)}`;
            })
            .filter(Boolean);
          return { details: {}, content: [{ type: "text", text: blocks.join("\n\n---\n\n") }] };
        }

        return { details: {}, content: [{ type: "text", text: "Provide either `id` or `query` parameter." }], isError: true };
      }

      if (params.dimensions) throw new Error("Dynamic dimensions require PostgreSQL storage");
      const { read } = resolveRulesDirs(ctx.cwd, params.rules_dir);

      if (params.id) {
        const sourceDir = findEntryDir(params.id, read);
        if (!sourceDir) {
          return { details: {}, content: [{ type: "text", text: `Rule not found: ${params.id}` }], isError: true };
        }
        const entry = readIndex(sourceDir).find((e) => e.id === params.id)!;
        const rule = readRuleFile(path.join(sourceDir, entry.file));
        if (!rule) {
          return { details: {}, content: [{ type: "text", text: `Rule file missing: ${entry.file}` }], isError: true };
        }
        return { details: {}, content: [{ type: "text", text: serializeRule(rule) }] };
      }

      if (params.query) {
        const topK = params.top_k ?? 3;
        const allEntries = mergeEntries(read).filter((e) => e.status === "active");

        const ruleMap = new Map<string, Rule>();
        for (const entry of allEntries) {
          const rule = readRuleFile(path.join(entry.sourceDir, entry.file));
          if (rule) ruleMap.set(rule.id, rule);
        }

        if (ruleMap.size === 0) {
          return { details: {}, content: [{ type: "text", text: "No active rules found." }] };
        }

        const search = buildSemanticEngine(Array.from(ruleMap.values()));
        const results = search(params.query, topK);

        if (results.length === 0) {
          return { details: {}, content: [{ type: "text", text: "No matching rules found for query." }] };
        }

        const blocks = results
          .map(([id, score]) => {
            const rule = ruleMap.get(id);
            if (!rule) return null;
            return `<!-- relevance score: ${score.toFixed(3)} -->\n${serializeRule(rule)}`;
          })
          .filter(Boolean);

        return { details: {}, content: [{ type: "text", text: blocks.join("\n\n---\n\n") }] };
      }

      return { details: {}, content: [{ type: "text", text: "Provide either `id` or `query` parameter." }], isError: true };
    },
  });

  pi.registerTool({
    name: "ruleset_get_reference", label: "Read reference", description: "Read a PostgreSQL reference document by name",
    parameters: Type.Object({name: Type.String()}),
    async execute(_id, params, _signal, _update, ctx) {
      const store = await getPostgresStore(ctx.cwd);
      const content = store ? await store.getReference(params.name) : null;
      return {details: {}, content: [{type: "text", text: content ?? "Reference not found (this tool requires PostgreSQL storage)"}], isError: content === null};
    }
  });

  pi.registerTool({
    name: "ruleset_restore", label: "Restore rule", description: "Restore an archived PostgreSQL rule by ID",
    parameters: Type.Object({id: Type.String()}),
    async execute(_id, params, _signal, _update, ctx) {
      const store = await getPostgresStore(ctx.cwd);
      const restored = store ? await store.restore(params.id, await actor(ctx.cwd)) : false;
      return {details: {}, content: [{type: "text", text: restored ? `Rule restored: ${params.id}` : "Archived rule not found (requires PostgreSQL storage)"}], isError: !restored};
    }
  });

  // -------------------------------------------------------------------------
  // ruleset_add_reference
  // -------------------------------------------------------------------------
  pi.registerTool({
    name: "ruleset_add_reference",
    label: "Add Reference",
    description: "Add a reference Markdown document to the references/ directory",
    parameters: Type.Object({
      name: Type.String({ description: "File name (e.g. pricing-policy.md)" }),
      content: Type.String({ description: "Markdown content of the reference document" }),
      target: Type.Optional(Type.Union(
        [Type.Literal("project"), Type.Literal("global")],
        { description: "Write to project or global dir (default: same as ruleset_add)" }
      )),
      rules_dir: Type.Optional(Type.String()),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const postgres = await getPostgresStore(ctx.cwd);
      if (postgres) {
        if (params.rules_dir || params.target) throw new Error("PostgreSQL uses configured namespace; rules_dir/target are Markdown-only");
        await postgres.addReference(params.name, params.content);
        return { details: {}, content: [{type: "text", text: `Reference saved: ${params.name}`}] };
      }
      const dirs = resolveRulesDirs(ctx.cwd, params.rules_dir);
      let writeDir = dirs.write;
      if (params.target === "global") writeDir = dirs.globalDir;
      if (params.target === "project") writeDir = dirs.projectDir ?? dirs.globalDir;

      const refDir = referencesDir(writeDir);
      fs.mkdirSync(refDir, { recursive: true });

      const fileName = params.name.endsWith(".md") ? params.name : `${params.name}.md`;
      const filePath = path.join(refDir, fileName);
      fs.writeFileSync(filePath, params.content, "utf-8");

      return { details: {}, content: [{
          type: "text",
          text: `Reference added: references/${fileName}\nLink with: [${path.basename(fileName, ".md")}](../references/${fileName})`,
        }],
      };
    },
  });
}
