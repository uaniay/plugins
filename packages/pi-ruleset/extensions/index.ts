import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import * as fs from "fs";
import * as path from "path";
// @ts-ignore — no bundled types for wink-bm25-text-search
import bm25 from "wink-bm25-text-search";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Rule {
  id: string;
  title: string;
  status: "active" | "inactive";
  priority: "high" | "medium" | "low";
  tags: string[];
  summary: string;
  description: string;
  raw_description?: string;   // original user words, preserved verbatim
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

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

function todayStr(): string {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

function resolveBaseDir(rulesDir: string, cwd: string): string {
  return path.isAbsolute(rulesDir) ? rulesDir : path.join(cwd, rulesDir);
}

function dailyDir(baseDir: string, date: string): string {
  return path.join(baseDir, date); // e.g. ./rules/2026-08-25/
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
    if (!line.startsWith("|") || line.startsWith("| ID") || line.startsWith("| --")) continue;
    const cols = line.split("|").map((c) => c.trim()).filter(Boolean);
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
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2);
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
  if (entries.length === 0) return () => [];

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
  if (rules.length === 0) return () => [];

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
// Extension entry point
// ---------------------------------------------------------------------------

export default function (pi: ExtensionAPI) {
  const DEFAULT_DIR = "./rules";

  const FULL_INJECT_THRESHOLD = 10;
  const priorityOrder: Record<string, number> = { high: 0, medium: 1, low: 2 };

  // Build the rules block injected into every agent turn.
  // < FULL_INJECT_THRESHOLD active rules → inject full rule content directly.
  // >= FULL_INJECT_THRESHOLD            → inject index summary only; agent uses ruleset_get for details.
  function buildRulesBlock(baseDir: string): string | null {
    const entries = readIndex(baseDir).filter((e) => e.status === "active");
    if (entries.length === 0) return null;

    const sorted = [...entries].sort(
      (a, b) => (priorityOrder[a.priority] ?? 9) - (priorityOrder[b.priority] ?? 9)
    );

    if (sorted.length < FULL_INJECT_THRESHOLD) {
      // full content mode
      const blocks: string[] = [
        "## Active Business Rules",
        "",
        "Apply these rules to every relevant task. Rules are ordered high → medium → low priority.",
        "",
      ];
      for (const entry of sorted) {
        const rule = readRuleFile(path.join(baseDir, entry.file));
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

  // before_agent_start: fires once per user turn before the agent loop.
  // Returns { systemPrompt } to append rules — chained with other extensions.
  pi.on("before_agent_start", (event, ctx) => {
    const baseDir = resolveBaseDir(DEFAULT_DIR, ctx.cwd);
    const block = buildRulesBlock(baseDir);
    if (!block) return;
    return { systemPrompt: event.systemPrompt + "\n\n" + block };
  });

  // context: fires before every LLM provider request — keeps rules visible after compaction.
  // Returns { messages } with the injected block appended.
  pi.on("context", (event, ctx) => {
    const baseDir = resolveBaseDir(DEFAULT_DIR, ctx.cwd);
    const block = buildRulesBlock(baseDir);
    if (!block) return;
    return { messages: [...event.messages, { role: "user", content: block }] };
  });

  pi.on("session_start", (_event, ctx) => {
    const baseDir = resolveBaseDir(DEFAULT_DIR, ctx.cwd);
    if (!fs.existsSync(indexPath(baseDir))) {
      ctx.ui.notify(
        "pi-ruleset: no rule index found — use ruleset_add to create your first rule",
        "info"
      );
    } else {
      const entries = readIndex(baseDir).filter((e) => e.status === "active");
      if (entries.length > 0) {
        ctx.ui.notify(
          `pi-ruleset: ${entries.length} active rule${entries.length > 1 ? "s" : ""} loaded`,
          "info"
        );
      }
    }
  });

  // -------------------------------------------------------------------------
  // ruleset_add
  // -------------------------------------------------------------------------
  pi.registerTool({
    name: "ruleset_add",
    label: "Add Rule",
    description:
      "Add a new business rule. Automatically checks for similar existing rules before writing — returns candidates for LLM confirmation if similarity is detected.",
    parameters: Type.Object({
      title: Type.String({ description: "Short title for the rule" }),
      summary: Type.String({ description: "One-sentence summary shown in the index" }),
      description: Type.String({ description: "Full description of what this rule governs" }),
      conditions: Type.Array(Type.String(), { default: [], description: "Conditions that trigger this rule (can be empty if not yet known)" }),
      actions: Type.Array(Type.String(), { default: [], description: "Actions to take when conditions are met (can be empty if not yet known)" }),
      priority: Type.Union(
        [Type.Literal("high"), Type.Literal("medium"), Type.Literal("low")],
        { default: "medium" }
      ),
      tags: Type.Array(Type.String(), { default: [] }),
      scope: Type.Optional(Type.Array(Type.String(), {
        description: "Customer IDs or names this rule applies to. Empty or omit = applies to all customers.",
      })),
      raw_description: Type.Optional(Type.String({
        description: "Original user words describing the rule — paste verbatim, preserved as-is alongside the structured description",
      })),
      references: Type.Array(Type.String(), {
        default: [],
        description: "Markdown file paths under references/ (e.g. pricing-policy.md)",
      }),
      rules_dir: Type.Optional(Type.String({ description: "Base directory for rules (default: ./rules)" })),
      force: Type.Optional(
        Type.Boolean({ description: "Skip similarity check and force-add as new rule", default: false })
      ),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const baseDir = resolveBaseDir(params.rules_dir ?? DEFAULT_DIR, ctx.cwd);
      const entries = readIndex(baseDir);

      // Layer 1: algorithmic similarity check
      if (!params.force) {
        const candidates = findSimilarRules(
          params.title,
          params.summary,
          params.tags ?? [],
          entries
        );
        if (candidates.length > 0) {
          const list = candidates
            .map(
              (c) =>
                `- [${c.entry.id}] "${c.entry.title}" (score ${Math.round(c.score * 100)}%) — ${c.reasons.join(", ")}\n  Summary: ${c.entry.summary}`
            )
            .join("\n");
          return {
            content: [
              {
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
              },
            ],
          };
        }
      }

      const today = todayStr();
      const id = nextId(entries);
      const slug = slugify(params.title);
      const filePath = ruleFilePath(baseDir, today, id, slug);
      const relPath = path.relative(baseDir, filePath);

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

      entries.push({
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
      writeIndex(baseDir, entries);

      return {
        content: [{ type: "text", text: `Rule added: ${id} — ${params.title}\nFile: ${relPath}` }],
      };
    },
  });

  // -------------------------------------------------------------------------
  // ruleset_update
  // -------------------------------------------------------------------------
  pi.registerTool({
    name: "ruleset_update",
    label: "Update Rule",
    description: "Update fields of an existing rule by ID",
    parameters: Type.Object({
      id: Type.String({ description: "Rule ID to update (e.g. 001)" }),
      title: Type.Optional(Type.String()),
      summary: Type.Optional(Type.String()),
      description: Type.Optional(Type.String()),
      raw_description: Type.Optional(Type.String({ description: "Append or replace original user description" })),
      conditions: Type.Optional(Type.Array(Type.String())),
      actions: Type.Optional(Type.Array(Type.String())),
      priority: Type.Optional(
        Type.Union([Type.Literal("high"), Type.Literal("medium"), Type.Literal("low")])
      ),
      status: Type.Optional(Type.Union([Type.Literal("active"), Type.Literal("inactive")])),
      tags: Type.Optional(Type.Array(Type.String())),
      scope: Type.Optional(Type.Array(Type.String({ description: "Customer IDs/names; empty = all" }))),
      references: Type.Optional(Type.Array(Type.String())),
      rules_dir: Type.Optional(Type.String()),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const baseDir = resolveBaseDir(params.rules_dir ?? DEFAULT_DIR, ctx.cwd);
      const entries = readIndex(baseDir);
      const entry = entries.find((e) => e.id === params.id);
      if (!entry) {
        return {
          content: [{ type: "text", text: `Rule not found: ${params.id}` }],
          isError: true,
        };
      }

      const fullPath = path.join(baseDir, entry.file);
      const rule = readRuleFile(fullPath);
      if (!rule) {
        return {
          content: [{ type: "text", text: `Rule file missing: ${entry.file}` }],
          isError: true,
        };
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

      // sync index entry
      entry.title = rule.title;
      entry.summary = rule.summary;
      entry.status = rule.status;
      entry.priority = rule.priority;
      entry.tags = rule.tags;
      entry.scope = rule.scope ?? [];
      entry.updated = rule.updated;
      writeIndex(baseDir, entries);

      return {
        content: [{ type: "text", text: `Rule updated: ${rule.id} — ${rule.title}` }],
      };
    },
  });

  // -------------------------------------------------------------------------
  // ruleset_remove
  // -------------------------------------------------------------------------
  pi.registerTool({
    name: "ruleset_remove",
    label: "Remove Rule",
    description: "Delete a rule by ID (moves file to .archive/ subdirectory for recovery)",
    parameters: Type.Object({
      id: Type.String({ description: "Rule ID to remove" }),
      rules_dir: Type.Optional(Type.String()),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const baseDir = resolveBaseDir(params.rules_dir ?? DEFAULT_DIR, ctx.cwd);
      const entries = readIndex(baseDir);
      const idx = entries.findIndex((e) => e.id === params.id);
      if (idx === -1) {
        return {
          content: [{ type: "text", text: `Rule not found: ${params.id}` }],
          isError: true,
        };
      }

      const entry = entries[idx];
      const fullPath = path.join(baseDir, entry.file);

      // archive instead of delete
      if (fs.existsSync(fullPath)) {
        const archiveDir = path.join(path.dirname(fullPath), ".archive");
        fs.mkdirSync(archiveDir, { recursive: true });
        fs.renameSync(fullPath, path.join(archiveDir, path.basename(fullPath)));
      }

      entries.splice(idx, 1);
      writeIndex(baseDir, entries);

      return {
        content: [{ type: "text", text: `Rule removed: ${entry.id} — ${entry.title} (archived)` }],
      };
    },
  });

  // -------------------------------------------------------------------------
  // ruleset_list
  // -------------------------------------------------------------------------
  pi.registerTool({
    name: "ruleset_list",
    label: "List Rules",
    description: "List all rules from the index with their summaries",
    parameters: Type.Object({
      status: Type.Optional(
        Type.Union(
          [Type.Literal("active"), Type.Literal("inactive"), Type.Literal("all")],
          { default: "all" }
        )
      ),
      rules_dir: Type.Optional(Type.String()),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const baseDir = resolveBaseDir(params.rules_dir ?? DEFAULT_DIR, ctx.cwd);
      const entries = readIndex(baseDir);
      const filter = params.status ?? "all";
      const filtered = filter === "all" ? entries : entries.filter((e) => e.status === filter);

      if (filtered.length === 0) {
        return { content: [{ type: "text", text: "No rules found." }] };
      }

      const priorityOrder = { high: 0, medium: 1, low: 2 };
      const sorted = [...filtered].sort(
        (a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]
      );

      const lines = sorted.map(
        (e) =>
          `[${e.id}] ${e.title} | ${e.status} | ${e.priority} | ${e.tags.join(", ") || "—"}\n    ${e.summary}`
      );

      return { content: [{ type: "text", text: lines.join("\n") }] };
    },
  });

  // -------------------------------------------------------------------------
  // ruleset_get — semantic search + full rule content
  // -------------------------------------------------------------------------
  pi.registerTool({
    name: "ruleset_get",
    label: "Get Rules",
    description:
      "Retrieve full rule content by ID or semantic query. Use before applying any rule to a task.",
    parameters: Type.Object({
      id: Type.Optional(Type.String({ description: "Exact rule ID (e.g. 001)" })),
      query: Type.Optional(
        Type.String({ description: "Natural language query to find relevant rules semantically" })
      ),
      top_k: Type.Optional(
        Type.Number({ default: 3, description: "Max number of rules to return for query mode" })
      ),
      rules_dir: Type.Optional(Type.String()),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const baseDir = resolveBaseDir(params.rules_dir ?? DEFAULT_DIR, ctx.cwd);
      const entries = readIndex(baseDir);

      // exact ID lookup
      if (params.id) {
        const entry = entries.find((e) => e.id === params.id);
        if (!entry) {
          return {
            content: [{ type: "text", text: `Rule not found: ${params.id}` }],
            isError: true,
          };
        }
        const rule = readRuleFile(path.join(baseDir, entry.file));
        if (!rule) {
          return {
            content: [{ type: "text", text: `Rule file missing: ${entry.file}` }],
            isError: true,
          };
        }
        return { content: [{ type: "text", text: serializeRule(rule) }] };
      }

      // semantic query via BM25
      if (params.query) {
        const topK = params.top_k ?? 3;
        const activeEntries = entries.filter((e) => e.status === "active");

        // load full rule objects
        const ruleMap = new Map<string, Rule>();
        for (const entry of activeEntries) {
          const rule = readRuleFile(path.join(baseDir, entry.file));
          if (rule) ruleMap.set(rule.id, rule);
        }

        if (ruleMap.size === 0) {
          return { content: [{ type: "text", text: "No active rules found." }] };
        }

        const search = buildSemanticEngine(Array.from(ruleMap.values()));
        const results = search(params.query, topK);

        if (results.length === 0) {
          return { content: [{ type: "text", text: "No matching rules found for query." }] };
        }

        const blocks = results
          .map(([id, score]) => {
            const rule = ruleMap.get(id);
            if (!rule) return null;
            return `<!-- relevance score: ${score.toFixed(3)} -->\n${serializeRule(rule)}`;
          })
          .filter(Boolean);

        return { content: [{ type: "text", text: blocks.join("\n\n---\n\n") }] };
      }

      return {
        content: [{ type: "text", text: "Provide either `id` or `query` parameter." }],
        isError: true,
      };
    },
  });

  // -------------------------------------------------------------------------
  // ruleset_add_reference — add a reference doc to references/
  // -------------------------------------------------------------------------
  pi.registerTool({
    name: "ruleset_add_reference",
    label: "Add Reference",
    description: "Add a reference Markdown document to the references/ directory",
    parameters: Type.Object({
      name: Type.String({ description: "File name (e.g. pricing-policy.md)" }),
      content: Type.String({ description: "Markdown content of the reference document" }),
      rules_dir: Type.Optional(Type.String()),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const baseDir = resolveBaseDir(params.rules_dir ?? DEFAULT_DIR, ctx.cwd);
      const refDir = referencesDir(baseDir);
      fs.mkdirSync(refDir, { recursive: true });

      const fileName = params.name.endsWith(".md") ? params.name : `${params.name}.md`;
      const filePath = path.join(refDir, fileName);
      fs.writeFileSync(filePath, params.content, "utf-8");

      return {
        content: [
          {
            type: "text",
            text: `Reference added: references/${fileName}\nLink with: [${path.basename(fileName, ".md")}](../references/${fileName})`,
          },
        ],
      };
    },
  });
}
