#!/usr/bin/env python3
"""
build-html-email.py

Converts a structured plain-text email draft into a styled HTML email body.

Usage:
    python3 build-html-email.py --input draft.txt --output email.html
    python3 build-html-email.py --stdin   (reads from stdin, prints to stdout)

Input format (draft.txt):
    Subject: Your subject here
    To: recipient@example.com

    Hi Name,

    Body paragraphs here.

    - List item 1
    - List item 2

    | Col A | Col B | Value |
    |-------|-------|-------|
    | R1    | data  | 123   |

    https://example.com/link  Link Label

    Best regards,
    Sender Name
"""

import sys
import re
import argparse


STYLE = """
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
       font-size: 15px; line-height: 1.6; color: #222; max-width: 640px;
       margin: 0 auto; padding: 24px 16px; }
p    { margin: 0 0 14px; }
ul, ol { margin: 0 0 14px; padding-left: 24px; }
li   { margin-bottom: 4px; }
a    { color: #0066cc; }
table { border-collapse: collapse; width: 100%; margin-bottom: 14px; font-size: 14px; }
th   { background: #f4f4f4; border: 1px solid #ddd; padding: 8px; text-align: left; }
td   { border: 1px solid #ddd; padding: 8px; }
td.num, th.num { text-align: right; }
pre  { background: #f6f8fa; border-radius: 4px; padding: 12px;
       font-size: 13px; overflow-x: auto; }
code { font-family: 'SFMono-Regular', Consolas, monospace; }
hr   { border: none; border-top: 1px solid #eee; margin: 20px 0; }
""".strip()


def is_number(s):
    return re.match(r'^[\d,.\-\+%$€£¥]+$', s.strip()) is not None


def parse_markdown_table(lines):
    rows = [l.strip() for l in lines if l.strip()]
    rows = [r for r in rows if not re.match(r'^\|[-| :]+\|$', r)]
    html = ['<table>']
    for i, row in enumerate(rows):
        cells = [c.strip() for c in row.strip('|').split('|')]
        tag = 'th' if i == 0 else 'td'
        html.append('<tr>' + ''.join(
            f'<{tag} class="num">{c}</{tag}>' if (tag == 'td' and is_number(c))
            else f'<{tag}>{c}</{tag}>'
            for c in cells
        ) + '</tr>')
    html.append('</table>')
    return '\n'.join(html)


def convert_links(text):
    # Labeled link: https://... Label text
    text = re.sub(
        r'(https?://\S+)\s+([^\n<]+)',
        lambda m: f'<a href="{m.group(1)}">{m.group(2).strip()}</a>',
        text
    )
    # Bare URL
    text = re.sub(
        r'(?<!["\'])(https?://\S+)',
        lambda m: f'<a href="{m.group(1)}">{m.group(1)}</a>',
        text
    )
    return text


def convert_body(body: str) -> str:
    lines = body.split('\n')
    html_parts = []
    i = 0

    while i < len(lines):
        line = lines[i]

        # Markdown table
        if line.strip().startswith('|'):
            table_lines = []
            while i < len(lines) and lines[i].strip().startswith('|'):
                table_lines.append(lines[i])
                i += 1
            html_parts.append(parse_markdown_table(table_lines))
            continue

        # Bullet list
        if re.match(r'^[-*] ', line.strip()):
            list_items = []
            while i < len(lines) and re.match(r'^[-*] ', lines[i].strip()):
                item = re.sub(r'^[-*] ', '', lines[i].strip())
                list_items.append(f'<li>{convert_links(item)}</li>')
                i += 1
            html_parts.append('<ul>' + ''.join(list_items) + '</ul>')
            continue

        # Code block
        if line.strip().startswith('```'):
            code_lines = []
            i += 1
            while i < len(lines) and not lines[i].strip().startswith('```'):
                code_lines.append(lines[i])
                i += 1
            i += 1
            html_parts.append('<pre><code>' + '\n'.join(code_lines) + '</code></pre>')
            continue

        # Horizontal rule
        if re.match(r'^---+$', line.strip()):
            html_parts.append('<hr>')
            i += 1
            continue

        # Empty line → paragraph break
        if line.strip() == '':
            i += 1
            continue

        # Regular paragraph line — collect until blank
        para_lines = []
        while i < len(lines) and lines[i].strip() != '' \
              and not lines[i].strip().startswith('|') \
              and not re.match(r'^[-*] ', lines[i].strip()) \
              and not lines[i].strip().startswith('```'):
            para_lines.append(lines[i].strip())
            i += 1
        para = ' '.join(para_lines)
        para = convert_links(para)
        html_parts.append(f'<p>{para}</p>')

    return '\n'.join(html_parts)


def build_html(subject: str, body: str) -> str:
    body_html = convert_body(body)
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{subject}</title>
<style>{STYLE}</style>
</head>
<body>
{body_html}
</body>
</html>"""


def parse_draft(text: str):
    subject = ''
    lines = text.split('\n')
    body_start = 0
    for i, line in enumerate(lines):
        if line.lower().startswith('subject:'):
            subject = line[8:].strip()
        elif line.strip() == '' and subject:
            body_start = i + 1
            break
    body = '\n'.join(lines[body_start:])
    return subject, body


def main():
    parser = argparse.ArgumentParser(description='Convert email draft to HTML')
    parser.add_argument('--input', help='Input draft file')
    parser.add_argument('--output', help='Output HTML file')
    parser.add_argument('--stdin', action='store_true', help='Read from stdin')
    args = parser.parse_args()

    if args.stdin or not args.input:
        text = sys.stdin.read()
    else:
        with open(args.input, 'r') as f:
            text = f.read()

    subject, body = parse_draft(text)
    html = build_html(subject, body)

    if args.output:
        with open(args.output, 'w') as f:
            f.write(html)
        print(f'Written to {args.output}')
    else:
        print(html)


if __name__ == '__main__':
    main()
