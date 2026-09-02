# pi-info-collector

A pi extension that lets agents collect missing credentials and configuration values from the user at runtime via a form dialog, then inject them into `process.env`.

## Install

```
pi install ./packages/pi-info-collector
```

---

## What it does

Agents often need values they don't have yet — API keys, tokens, passwords, database connection details. Without this package, the only option is to fail and ask the user to restart with the right env vars set. With `collect_info`, the agent pauses mid-task, sends all missing fields to the frontend in one RPC round-trip, the user fills the form, and the agent continues from where it left off.

Collected values are written directly into `process.env`, so every subsequent shell command or subprocess the agent spawns can read them immediately — no restart required.

---

## Tool

### `collect_info(fields, reason?)`

Sends a form request to the frontend, waits for the user to submit, then injects returned values into `process.env`.

**Parameters**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `fields` | `Field[]` | yes | List of values to collect |
| `reason` | `string` | no | Why these values are needed — shown above the form |

**Field schema**

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `key` | `string` | — | `process.env` key name, e.g. `GITHUB_TOKEN` |
| `label` | `string` | — | Human-readable label shown in the form |
| `description` | `string` | — | Placeholder or hint text |
| `secret` | `boolean` | `false` | Render as password input |
| `required` | `boolean` | `true` | If false, the user can leave the field empty |

**Return value**

```json
{ "collected": ["GITHUB_TOKEN"], "skipped": ["OPTIONAL_KEY"] }
```

**Error cases** — tool throws, agent stops:
- User dismisses the dialog and at least one required field has no existing value
- User submits empty input for a required field with no existing value

---

## RPC protocol

This package uses `ctx.ui.input()` as a transport to deliver a structured JSON payload to the frontend. All fields are sent in **one round-trip** — the frontend renders a single form dialog.

### How `ctx.ui.input()` works in RPC mode

In TUI mode, `ctx.ui.input()` renders a terminal input box.
In RPC mode (web frontend), it emits an `extension_ui_request` event over the RPC channel and suspends until the frontend responds with `extension_ui_response`. The tool call is mid-execution — no further LLM turns happen while waiting.

### Request

The extension calls:

```ts
ctx.ui.input("collect_info", JSON.stringify(collectRequest))
```

Which emits over RPC:

```json
{
  "type": "extension_ui_request",
  "method": "input",
  "id": "<uuid>",
  "title": "collect_info",
  "placeholder": "<JSON-encoded CollectRequest>"
}
```

**`CollectRequest` shape:**

```ts
interface CollectRequest {
  method: "collect";
  reason?: string;
  fields: Array<{
    key: string;
    label: string;
    description?: string;
    secret: boolean;        // true → render as <input type="password">
    required: boolean;
    hasExisting: boolean;   // true → a value is already set in process.env
  }>;
}
```

### Response

The frontend sends back:

```json
{
  "type": "extension_ui_response",
  "id": "<same uuid>",
  "value": "<JSON-encoded CollectResponse>"
}
```

**`CollectResponse` shape:**

```ts
interface CollectResponse {
  values: Record<string, string | null>;
  // string  → submitted value, written to process.env
  // null    → user skipped or left blank
}
```

Sending `value: undefined` (no value field) means the user dismissed the dialog entirely.

---

## Frontend implementation guide

The frontend must handle `extension_ui_request` events where `title === "collect_info"` differently from plain input dialogs.

### Detection

```ts
socket.on("extension_ui_request", (event) => {
  if (event.method === "input" && event.title === "collect_info") {
    handleCollectInfo(event);
  } else if (event.method === "input") {
    handlePlainInput(event);
  } else if (event.method === "select") {
    handleSelect(event);
  } else if (event.method === "confirm") {
    handleConfirm(event);
  }
});
```

### Parsing

```ts
function handleCollectInfo(event) {
  const request: CollectRequest = JSON.parse(event.placeholder);
  showCollectForm(event.id, request);
}
```

### Rendering rules

- Show `request.reason` as a description above the form if present
- Render one input per field in order
- `secret: true` → `<input type="password">`
- `hasExisting: true` → show hint "already set — leave blank to keep"
- `required: true` + `hasExisting: false` → disable submit if field is empty
- `required: false` → field is optional, allow empty submission

### Submitting

```ts
function onSubmit(eventId: string, formValues: Record<string, string>) {
  const values: Record<string, string | null> = {};
  for (const [key, val] of Object.entries(formValues)) {
    values[key] = val === "" ? null : val;
  }
  socket.emit("extension_ui_response", {
    id: eventId,
    value: JSON.stringify({ values }),
  });
}
```

### Cancelling

```ts
function onDismiss(eventId: string) {
  socket.emit("extension_ui_response", {
    id: eventId,
    // no value field → undefined → treated as full cancellation
  });
}
```

---

## All `ctx.ui` methods

These are available inside any tool `execute()` or event handler via `ctx.ui`.

| Method | Signature | RPC behavior |
|--------|-----------|--------------|
| `input` | `(title, placeholder?, opts?) → Promise<string \| undefined>` | Emits `extension_ui_request { method: "input" }`. Returns user's string or `undefined` on cancel. |
| `select` | `(title, options[], opts?) → Promise<string \| undefined>` | Emits `extension_ui_request { method: "select" }` with option list. |
| `confirm` | `(title, message, opts?) → Promise<boolean>` | Emits `extension_ui_request { method: "confirm" }`. Returns `true`/`false`. |
| `notify` | `(message, type?) → void` | Emits a notification event. Fire-and-forget, does not suspend execution. `type`: `"info" \| "warning" \| "error"`. |
| `setStatus` | `(key, text?) → void` | Sets footer status text. Pass `undefined` to clear. |
| `setWorkingMessage` | `(message?) → void` | Sets the streaming loading message. |
| `setWorkingVisible` | `(visible) → void` | Shows or hides the loading indicator row. |
| `editor` | `(title, prefill?) → Promise<string \| undefined>` | Opens a multi-line text editor dialog. |

**Dialog options** (`opts`):

```ts
interface ExtensionUIDialogOptions {
  signal?: AbortSignal;  // programmatically dismiss
  timeout?: number;      // auto-dismiss after N ms with countdown
}
```

---

## All lifecycle events

Register with `pi.on(event, handler)`. Handlers receive `(event, ctx)`.

### Project

| Event | Fired when | Can return |
|-------|------------|------------|
| `project_trust` | Entering a project directory | `{ trusted: "yes" \| "no" \| "undecided", remember?: boolean }` |
| `resources_discover` | Startup or reload | `{ skillPaths?, promptPaths?, themePaths? }` |

### Session

| Event | Fired when | Can return |
|-------|------------|------------|
| `session_start` | Session starts, loads, or reloads | — |
| `session_info_changed` | Session name changes | — |
| `session_before_switch` | Before switching sessions | `{ cancel?: boolean }` |
| `session_before_fork` | Before forking a session | `{ cancel?: boolean, skipConversationRestore?: boolean }` |
| `session_before_compact` | Before context compaction | `{ cancel?: boolean, compaction?: CompactionResult }` |
| `session_compact` | After compaction succeeds | — |
| `session_compact_failed` | After compaction fails or is aborted | — |
| `session_shutdown` | Session is torn down (quit, reload, switch) | — |
| `session_before_tree` | Before tree navigation | `{ cancel?, summary?, customInstructions?, label? }` |
| `session_tree` | After tree navigation completes | — |

`session_start` event fields:

```ts
{
  reason: "startup" | "reload" | "new" | "resume" | "fork";
  previousSessionFile?: string;
}
```

### Agent / Provider

| Event | Fired when | Can return |
|-------|------------|------------|
| `before_agent_start` | After user submits prompt, before agent loop | `{ systemPrompt?: string, message? }` |
| `agent_start` | Agent loop begins | — |
| `agent_end` | Agent loop ends | — |
| `agent_settled` | Agent fully done, no retry or queue | — |
| `context` | Before every LLM API call | `{ messages?: AgentMessage[] }` |
| `before_provider_request` | Before provider HTTP request | replacement payload |
| `before_provider_headers` | After headers assembled, before HTTP call | mutate `event.headers` in place |
| `after_provider_response` | After provider response received | — |

`before_agent_start` is the right place to append to `systemPrompt`:

```ts
pi.on("before_agent_start", (event, ctx) => {
  return { systemPrompt: event.systemPrompt + "\n\nExtra instructions." };
});
```

`context` fires before every LLM call and is the right place to inject or remove messages:

```ts
pi.on("context", (event, ctx) => {
  return { messages: [...event.messages, { role: "user", content: "Reminder: ..." }] };
});
```

### Turn / Message

| Event | Fired when | Can return |
|-------|------------|------------|
| `turn_start` | Each LLM turn begins | — |
| `turn_end` | Each LLM turn ends | — |
| `message_start` | A message begins (user, assistant, toolResult) | — |
| `message_update` | Streaming token update | — |
| `message_end` | A message finishes | `{ message?: AgentMessage }` |

### Tool

| Event | Fired when | Can return |
|-------|------------|------------|
| `tool_call` | Before a tool executes | `{ block?: boolean, reason?: string, terminate?: boolean }` |
| `tool_result` | After a tool executes | `{ content?, details?, isError?, usage? }` |
| `tool_execution_start` | Tool execution begins | — |
| `tool_execution_update` | Tool streaming output | — |
| `tool_execution_end` | Tool execution finishes | — |

Mutate `event.input` in place to patch tool arguments before execution:

```ts
pi.on("tool_call", (event, ctx) => {
  if (isToolCallEventType("bash", event)) {
    if (event.input.command.includes("rm -rf")) {
      return { block: true, reason: "Destructive command blocked" };
    }
  }
});
```

### Other

| Event | Fired when | Can return |
|-------|------------|------------|
| `input` | User input received, before agent processing | `{ action: "continue" } \| { action: "transform", text, images? } \| { action: "handled" }` |
| `user_bash` | User runs `!` or `!!` bash command | `{ operations?, result? }` |
| `model_select` | Model changes | — |
| `thinking_level_select` | Thinking level changes | — |

---

## ExtensionContext (`ctx`)

Available in all event handlers and tool `execute()`:

```ts
ctx.mode          // "tui" | "rpc" | "json" | "print"
ctx.hasUI         // true in TUI and RPC modes — dialogs work
ctx.cwd           // current working directory
ctx.model         // current Model object
ctx.isIdle()      // true when agent is not streaming
ctx.signal        // AbortSignal for current operation, or undefined
ctx.abort()       // abort current agent operation
ctx.getSystemPrompt()       // current effective system prompt
ctx.getContextUsage()       // { tokens, contextWindow, percent }
ctx.compact(opts?)          // trigger compaction
ctx.shutdown()              // gracefully exit pi
ctx.sessionManager          // read-only session state
```

Guard terminal-only UI with `ctx.mode`:

```ts
if (ctx.mode === "tui") {
  ctx.ui.setWidget("my-widget", lines);
}
```

---

## `pi` API methods

Available on the `pi` object passed to the extension factory.

```ts
pi.registerTool(definition)              // register LLM-callable tool
pi.registerCommand(name, options)        // register /slash command
pi.registerShortcut(keyId, options)      // register keyboard shortcut
pi.registerFlag(name, options)           // register CLI flag
pi.registerProvider(name, config)        // register model provider
pi.unregisterProvider(name)             // remove provider
pi.registerMessageRenderer(type, fn)    // custom message renderer
pi.registerMarkdownTransformer(fn)      // transform markdown before render
pi.registerEntryRenderer(type, fn)      // custom session entry renderer

pi.sendMessage(message, opts?)          // send custom message to session
pi.sendUserMessage(content, opts?)      // send user message, triggers turn
pi.appendEntry(customType, data?)       // append non-LLM entry to session

pi.getActiveTools()                     // currently active tool names
pi.getAllTools()                         // all tools with schemas
pi.setActiveTools(names)                // change active tool set
pi.getCommands()                        // available slash commands
pi.setModel(model)                      // switch model
pi.getThinkingLevel()                   // current thinking level
pi.setThinkingLevel(level)              // set thinking level
pi.getFlag(name)                        // read CLI flag value
pi.setSessionName(name)                 // set session display name
pi.getSessionName()                     // get session display name
pi.setLabel(entryId, label)             // label a session entry
pi.exec(command, args, opts?)           // run shell command
pi.events                               // shared EventBus
```

---

## Extension entry point

```ts
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  // register tools, commands, event handlers here
}
```

Or as a named inline extension:

```ts
export default {
  name: "my-extension",
  hidden: false,
  factory(pi: ExtensionAPI) {
    // ...
  },
};
```

---

## Example: tool + system prompt injection

```ts
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

export default function (pi: ExtensionAPI) {
  // Inject context into every agent turn
  pi.on("before_agent_start", (event, ctx) => {
    return { systemPrompt: event.systemPrompt + "\n\nProject: my-app" };
  });

  // Register a tool
  pi.registerTool({
    name: "my_tool",
    label: "My Tool",
    description: "Does something useful",
    promptSnippet: "my_tool(query) — look something up",
    promptGuidelines: [
      "Use my_tool before answering questions about X",
    ],
    parameters: Type.Object({
      query: Type.String({ description: "What to look up" }),
    }),
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const result = `Result for: ${params.query}`;
      return { content: [{ type: "text", text: result }] };
    },
  });
}
```

---

## Example: RPC form dialog (frontend)

Minimal frontend handler for `collect_info` requests:

```ts
interface CollectRequest {
  method: "collect";
  reason?: string;
  fields: Array<{
    key: string;
    label: string;
    description?: string;
    secret: boolean;
    required: boolean;
    hasExisting: boolean;
  }>;
}

interface CollectResponse {
  values: Record<string, string | null>;
}

rpc.on("extension_ui_request", (event) => {
  if (event.method !== "input") return;

  if (event.title === "collect_info") {
    const req: CollectRequest = JSON.parse(event.placeholder);
    openCollectForm({
      requestId: event.id,
      reason: req.reason,
      fields: req.fields,
      onSubmit(formValues: Record<string, string>) {
        const values: Record<string, string | null> = {};
        for (const f of req.fields) {
          const v = formValues[f.key] ?? "";
          values[f.key] = v === "" ? null : v;
        }
        rpc.send("extension_ui_response", {
          id: event.id,
          value: JSON.stringify({ values } satisfies CollectResponse),
        });
      },
      onDismiss() {
        rpc.send("extension_ui_response", { id: event.id });
      },
    });
    return;
  }

  // plain input dialog
  openInputDialog({
    title: event.title,
    placeholder: event.placeholder,
    onSubmit: (value) => rpc.send("extension_ui_response", { id: event.id, value }),
    onDismiss: ()     => rpc.send("extension_ui_response", { id: event.id }),
  });
});
```
