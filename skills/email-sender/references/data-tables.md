---
name: data-tables
description: Rules for formatting tables and structured data in emails
---

# Data & Table Formatting Rules

## Principles

Tables and data must be wrapped in appropriate syntax to preserve structure across email clients. Never insert raw tab-separated or space-aligned data into email body — it breaks on proportional fonts.

## HTML Email — Tables

Use a full HTML table with inline styles for maximum compatibility:

```html
<table style="border-collapse: collapse; width: 100%; font-family: sans-serif; font-size: 14px;">
  <thead>
    <tr style="background-color: #f4f4f4;">
      <th style="border: 1px solid #ddd; padding: 8px; text-align: left;">Column A</th>
      <th style="border: 1px solid #ddd; padding: 8px; text-align: left;">Column B</th>
      <th style="border: 1px solid #ddd; padding: 8px; text-align: right;">Value</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td style="border: 1px solid #ddd; padding: 8px;">Row 1</td>
      <td style="border: 1px solid #ddd; padding: 8px;">Data</td>
      <td style="border: 1px solid #ddd; padding: 8px; text-align: right;">123</td>
    </tr>
  </tbody>
</table>
```

Rules:
- Always use `border-collapse: collapse` and `border` on cells
- Numeric columns → `text-align: right`
- Header row → light background (`#f4f4f4`)
- No merged cells unless explicitly required

## Plain Text Email — Tables

Use ASCII table formatting wrapped in a monospace block:

```
| Column A | Column B | Value |
|----------|----------|-------|
| Row 1    | Data     |   123 |
| Row 2    | Data     |   456 |
```

Rules:
- Align columns with padding
- Right-align numeric columns
- Always include the separator row (`|---|`)
- Wrap the block in triple backticks if the email client renders Markdown (e.g., Notion, Slack-to-email bridges)

## Key-Value Data

For structured key-value pairs (config, settings, summaries), use a two-column table or a labeled list:

**HTML:**
```html
<dl style="font-family: sans-serif; font-size: 14px;">
  <dt style="font-weight: bold;">Status</dt><dd>Active</dd>
  <dt style="font-weight: bold;">Region</dt><dd>us-east-1</dd>
</dl>
```

**Plain text:**
```
Status : Active
Region : us-east-1
Owner  : alice@example.com
```

## Code Blocks

Wrap all code, commands, file paths, and technical strings in `<code>` or `<pre>` tags for HTML, or indent with 4 spaces for plain text:

**HTML:**
```html
<pre style="background:#f6f8fa; padding:12px; border-radius:4px; font-family:monospace; font-size:13px;">
npm install --save-dev jest
</pre>
```

**Plain text:**
```
    npm install --save-dev jest
```

Never paste raw code inline without wrapping — it loses formatting and is harder to copy.
