import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const FieldSchema = Type.Object({
  key: Type.String({ description: "Environment variable name, e.g. GITHUB_TOKEN" }),
  label: Type.String({ description: "Human-readable label shown to the user" }),
  description: Type.Optional(Type.String({ description: "Additional context shown as placeholder or hint" })),
  secret: Type.Optional(Type.Boolean({ description: "Render as password input (default: false)" })),
  required: Type.Optional(Type.Boolean({ description: "If false, user may skip this field (default: true)" })),
});

// Shape sent to the frontend via extension_ui_request { method: "collect" }
export interface CollectRequest {
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

// Shape the frontend sends back via extension_ui_response
export interface CollectResponse {
  // key → submitted value; null means user skipped/cancelled this field
  values: Record<string, string | null>;
}

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "collect_info",
    label: "Collect Info",
    description: "Prompt the user to provide missing values for one or more fields via a form dialog and inject them into process.env",
    promptSnippet: "collect_info(fields, reason?) — collect missing credentials or config values from the user and inject into current process",
    promptGuidelines: [
      // When to collect
      "Before executing any task that involves an external service, MCP tool, shell command, skill, or API call, identify every credential or configuration value it requires — such as API keys, tokens, passwords, database hosts/ports/usernames, account names, or secret URLs",
      "Check whether each required value is already set: run `printenv KEY` or `echo $KEY`. Treat an empty string or unset variable as missing",
      "If any required value is missing, call collect_info BEFORE proceeding — never assume a value exists, never hardcode a placeholder, never ask the user to set the env var themselves",

      // What counts as a required value
      "Values that always require collection if missing: API keys and tokens (e.g. GITHUB_TOKEN, OPENAI_API_KEY), passwords and secrets, database connection details (host, port, user, password, database name), account usernames or IDs for external services, any URL or endpoint the user must supply",

      // How to call collect_info
      "Group all missing values for a single task into one collect_info call — do not make one call per field",
      "Set reason to a clear one-sentence explanation of what the task needs and why, so the user understands what they are being asked for",
      "Set secret: true for any value that is a password, token, key, or other credential that should not be displayed in plaintext",
      "Set required: false only for genuinely optional values — if the task cannot proceed without the value, leave required at its default (true)",

      // After collection
      "After successful collection, immediately retry the original operation without asking the user again",
      "If the user cancels or skips a required field, stop the current task and explain clearly which value is missing and why the task cannot continue without it",
    ],
    parameters: Type.Object({
      fields: Type.Array(FieldSchema, {
        description: "Fields to collect from the user, presented as a single form",
        minItems: 1,
      }),
      reason: Type.Optional(Type.String({
        description: "Why these values are needed — shown to the user above the form",
      })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const fieldsMeta = params.fields.map((f) => ({
        key: f.key,
        label: f.label,
        description: f.description,
        secret: f.secret ?? false,
        required: f.required !== false,
        hasExisting: Boolean(process.env[f.key]),
      }));

      // Send all fields to the frontend in one RPC round-trip.
      // The frontend renders a form dialog and returns values for all fields at once.
      const request: CollectRequest = {
        method: "collect",
        reason: params.reason,
        fields: fieldsMeta,
      };

      const raw = await ctx.ui.input("collect_info", JSON.stringify(request));

      // raw === undefined means the user dismissed the dialog entirely
      if (raw === undefined) {
        const requiredKeys = fieldsMeta.filter((f) => f.required && !f.hasExisting).map((f) => f.key);
        if (requiredKeys.length > 0) {
          throw new Error(`User cancelled — required fields not provided: ${requiredKeys.join(", ")}`);
        }
        return {
          content: [{ type: "text", text: JSON.stringify({ collected: [], skipped: fieldsMeta.map((f) => f.key) }) }],
        };
      }

      let response: CollectResponse;
      try {
        response = JSON.parse(raw) as CollectResponse;
      } catch {
        throw new Error(`Invalid response from frontend: ${raw}`);
      }

      const collected: string[] = [];
      const skipped: string[] = [];

      for (const field of fieldsMeta) {
        const submitted = response.values[field.key];

        if (submitted === null || submitted === undefined) {
          if (field.required && !field.hasExisting) {
            throw new Error(`Required field not provided: ${field.key}`);
          }
          skipped.push(field.key);
          continue;
        }

        if (submitted === "" && field.hasExisting) {
          // blank → keep existing
          collected.push(field.key);
          continue;
        }

        if (submitted === "" && !field.hasExisting) {
          if (field.required) {
            throw new Error(`Required field submitted empty: ${field.key}`);
          }
          skipped.push(field.key);
          continue;
        }

        process.env[field.key] = submitted;
        collected.push(field.key);
      }

      return {
        content: [{ type: "text", text: JSON.stringify({ collected, skipped }) }],
      };
    },
  });
}
