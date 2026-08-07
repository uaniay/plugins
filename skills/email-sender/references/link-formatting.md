---
name: link-formatting
description: Rules for formatting URLs and hyperlinks in email body content
---

# Link Formatting Rules

## Principles

Raw URLs embedded in prose are hard to read and look unprofessional. Always format links to be human-readable and context-aware.

## HTML Email

Use anchor tags with descriptive text. Never expose raw URLs inline:

```html
<!-- Good -->
<a href="https://example.com/report/q2-2026">View Q2 Report</a>

<!-- Bad -->
https://example.com/report/q2-2026
```

Label rules:
- Use the document or page title when known: `View Q2 Report`
- Use action verbs for CTAs: `Download PDF`, `Open Dashboard`, `Review PR`
- Never use `click here` or `here` as link text

## Plain Text Email

When HTML is not available, format links on their own line with a label:

```
Report: https://example.com/report/q2-2026
Dashboard: https://app.example.com/dashboard
```

Never embed a raw URL mid-sentence in plain text. Place it after a label with a colon.

## Multiple Links

When there are 2+ links, group them as a labeled list at the bottom of the email, before the sign-off:

**HTML:**
```html
<ul>
  <li><a href="https://example.com/doc">Project Brief</a></li>
  <li><a href="https://example.com/slides">Presentation Slides</a></li>
  <li><a href="https://example.com/tracker">Issue Tracker</a></li>
</ul>
```

**Plain text:**
```
Resources:
- Project Brief: https://example.com/doc
- Presentation Slides: https://example.com/slides
- Issue Tracker: https://example.com/tracker
```

## Security Notes

- Never shorten URLs with third-party services (bit.ly, tinyurl) in professional email — recipients cannot verify destination
- Always use `https://` — never `http://`
- Do not include tracking parameters unless the user explicitly requests them
