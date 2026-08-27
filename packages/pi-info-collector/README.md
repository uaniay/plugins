# pi-info-collector

A pi extension that lets agents collect missing information from the user at runtime and inject it into `process.env`.

## Install

```
pi install ./packages/pi-info-collector
```

## What it does

Agents often need values they don't have yet — API keys, usernames, tokens, config flags. Without this package, the only option is to fail and ask the user to restart with the right env vars set. With `collect_info`, the agent pauses mid-task, asks the user for each missing value one at a time, then continues from where it left off.

Collected values are written directly into `process.env`, so every subsequent bash command or subprocess the agent spawns can read them immediately — no restart required.

## Tool

### `collect_info(fields, reason?)`

Prompts the user for one or more values and injects them into `process.env`.

**Parameters**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `fields` | `Field[]` | yes | List of values to collect (see below) |
| `reason` | `string` | no | Why these values are needed — shown to the user as a notification before collection starts |

**Field schema**

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `key` | `string` | — | Environment variable name, e.g. `GITHUB_TOKEN` |
| `label` | `string` | — | Human-readable label shown in the input dialog |
| `description` | `string` | — | Extra context shown as placeholder text |
| `secret` | `boolean` | `false` | If true, appends `[secret]` to the placeholder so the frontend renders a password input |
| `required` | `boolean` | `true` | If false, the user can skip this field |

**Return value**

```json
{ "collected": ["GITHUB_TOKEN"], "skipped": ["OPTIONAL_KEY"] }
```

**Error cases** (tool throws, agent stops):
- User cancels (Escape) a required field
- User submits empty input for a required field with no existing value

## How it works

### Architecture

```
Agent calls collect_info
        │
        ▼
  extension execute()
        │
        ├─ reason? → ctx.ui.notify()          [fire-and-forget, no await]
        │
        └─ for each field:
               │
               ▼
         ctx.ui.input(title, placeholder)
               │                              ← agent execution PAUSED here
               │   pi emits extension_ui_request {method:"input"} over RPC
               │   frontend renders input dialog
               │   user types and submits (or cancels)
               │   frontend sends extension_ui_response back over RPC
               │
               ▼
         Promise resolves with string | undefined
               │
               ├─ undefined + required  → throw Error  → framework marks isError=true
               ├─ ""       + hasExisting → keep existing value, add to collected
               ├─ ""       + !hasExisting + required → throw Error
               ├─ ""       + !hasExisting + optional → add to skipped
               └─ value    → process.env[key] = value, add to collected
```

### How `ctx.ui.input()` blocks the agent

`execute()` is an `async` function. Calling `await ctx.ui.input(...)` suspends the function at that line. Under the hood:

1. The extension runtime creates a `Promise` and stores its `resolve` callback in a `pendingExtensionRequests` map keyed by a UUID.
2. It emits an `extension_ui_request` RPC message to the frontend with `method: "input"`, the title, and the placeholder.
3. The frontend renders an input dialog. The agent's tool call is mid-execution — no further LLM turns happen.
4. When the user submits or cancels, the frontend sends an `extension_ui_response` with the same UUID back over RPC.
5. The runtime looks up the UUID in `pendingExtensionRequests`, calls `resolve(value)`, and the `Promise` settles.
6. `execute()` resumes from the `await` with the user's value (or `undefined` for cancel).

This is a standard JavaScript Promise suspension — no threads, no locks. The entire pi process event loop stays responsive; only this `execute()` call is waiting.

### How errors stop the agent

When `execute()` throws, the pi framework's tool executor catches the exception in its `executePreparedToolCall` wrapper and sets `isError: true` on the finalized tool result. This error result is written into the conversation as a `toolResult` message. The agent sees the error content and stops the current task.

### The `[secret]` convention

`ctx.ui.input()` has no native password-input mode. The extension signals "render as password" by appending `[secret]` to the placeholder string:

```
placeholder = "Your token description [secret]"
```

The frontend checks whether `placeholder` contains `[secret]`. If it does, it renders `<input type="password">` and strips the suffix before displaying it to the user.

### pi events used

This extension registers no pi lifecycle event handlers (`pi.on(...)`). It only registers a tool. All interaction happens synchronously within the tool's `execute()` call — the tool itself drives the entire collect-and-inject flow.

| pi API | Used for |
|--------|----------|
| `pi.registerTool()` | Register `collect_info` with its schema, prompt snippet, and guidelines |
| `ctx.ui.notify()` | Show the `reason` message before collection starts |
| `ctx.ui.input()` | Show each field's input dialog one at a time; awaiting this blocks the tool |
| `process.env[key] = value` | Inject collected values into the running process |

### System prompt injection

The extension injects the following into the agent's system prompt automatically via `promptSnippet` and `promptGuidelines`:

**Snippet** (added to the Available tools section):
```
collect_info(fields, reason?) — collect missing env vars or user input and inject into current process
```

**Guidelines** (added to the Guidelines section):
- Before collecting, check if the value already exists with `printenv KEY` or `echo $KEY`
- Use `collect_info` when a required value is missing — do not assume it exists
- Set `reason` to explain why the values are needed so the user can make an informed decision
- After successful collection, immediately retry the original operation without asking the user again
- If the user cancels a required field, stop the current task and clearly explain why
- For secret values (passwords, tokens), set `secret: true` so the frontend renders a password input

## Example agent call

```json
{
  "tool": "collect_info",
  "params": {
    "reason": "Pushing to GitHub requires a personal access token with repo scope",
    "fields": [
      {
        "key": "GITHUB_TOKEN",
        "label": "GitHub Personal Access Token",
        "description": "Needs repo scope",
        "secret": true
      },
      {
        "key": "GITHUB_USER",
        "label": "GitHub username",
        "required": false
      }
    ]
  }
}
```

After the call, `process.env.GITHUB_TOKEN` is set and the next `git push` or `gh` command picks it up without any shell re-export.
