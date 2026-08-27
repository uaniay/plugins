import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const FieldSchema = Type.Object({
  key: Type.String({ description: "Environment variable name, e.g. GITHUB_TOKEN" }),
  label: Type.String({ description: "Human-readable label shown to the user" }),
  description: Type.Optional(Type.String({ description: "Additional context shown to the user" })),
  secret: Type.Optional(Type.Boolean({ description: "Render as password input on frontend (default: false)" })),
  required: Type.Optional(Type.Boolean({ description: "If false, user may skip this field (default: true)" })),
});

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "collect_info",
    label: "Collect Info",
    description: "Prompt the user to provide missing values for one or more fields and inject them into process.env",
    promptSnippet: "collect_info(fields, reason?) — collect missing env vars or user input and inject into current process",
    promptGuidelines: [
      "Before collecting, check if the value already exists with printenv KEY or echo $KEY",
      "Use collect_info when a required value is missing — do not assume it exists",
      "Set reason to explain why the values are needed so the user can make an informed decision",
      "After successful collection, immediately retry the original operation without asking the user again",
      "If the user cancels a required field, stop the current task and clearly explain why",
      "For secret values (passwords, tokens), set secret: true so the frontend renders a password input",
    ],
    parameters: Type.Object({
      fields: Type.Array(FieldSchema, {
        description: "Fields to collect from the user, presented one at a time",
        minItems: 1,
      }),
      reason: Type.Optional(Type.String({
        description: "Explain why these values are needed — shown to the user before collection begins",
      })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      if (params.reason) {
        ctx.ui.notify(params.reason, "info");
      }

      const collected: string[] = [];
      const skipped: string[] = [];

      for (const field of params.fields) {
        const isRequired = field.required !== false;
        const hasExisting = Boolean(process.env[field.key]);

        let placeholder = field.description ?? "";
        if (hasExisting) {
          placeholder = placeholder
            ? `${placeholder} (leave blank to keep existing value)`
            : "Leave blank to keep existing value";
        }
        if (field.secret) {
          placeholder = placeholder ? `${placeholder} [secret]` : "[secret]";
        }

        const title = hasExisting ? `${field.label} (already set, leave blank to keep)` : field.label;
        const value = await ctx.ui.input(title, placeholder);

        if (value === undefined) {
          if (isRequired) {
            throw new Error(`User cancelled collection of required field: ${field.key}`);
          }
          skipped.push(field.key);
          continue;
        }

        if (value === "" && hasExisting) {
          // blank input — preserve existing value
          collected.push(field.key);
          continue;
        }

        if (value === "" && !hasExisting) {
          if (isRequired) {
            throw new Error(`No value provided for required field: ${field.key}`);
          }
          skipped.push(field.key);
          continue;
        }

        process.env[field.key] = value;
        collected.push(field.key);
      }

      return {
        content: [{ type: "text", text: JSON.stringify({ collected, skipped }) }],
      };
    },
  });
}
