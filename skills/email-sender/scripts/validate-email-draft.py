#!/usr/bin/env python3
"""
validate-email-draft.py

Validates an email draft against the formatting rules before sending.
Checks: subject line, sign-off, links, tables, and greeting.

Usage:
    python3 validate-email-draft.py --input draft.txt
    echo "draft content" | python3 validate-email-draft.py --stdin

Exit codes:
    0 — all checks passed
    1 — one or more warnings or errors found
"""

import sys
import re
import argparse


ERRORS = []
WARNINGS = []


def error(msg):
    ERRORS.append(f'  [ERROR]   {msg}')


def warn(msg):
    WARNINGS.append(f'  [WARN]    {msg}')


def check_subject(lines):
    subject_line = next((l for l in lines if l.lower().startswith('subject:')), None)
    if not subject_line:
        error('Missing Subject: line')
        return
    subject = subject_line[8:].strip()
    if not subject:
        error('Subject is empty')
    elif len(subject) > 60:
        warn(f'Subject is {len(subject)} chars — keep under 60 (current: "{subject}")')
    vague = {'important', 'hello', 'fyi', 'hi', 'update', 'follow up'}
    if subject.lower().strip() in vague:
        warn(f'Vague subject: "{subject}" — be more specific')


def check_greeting(body):
    first_line = next((l.strip() for l in body.split('\n') if l.strip()), '')
    valid_greetings = ('hi ', 'dear ', 'hello ', 'hi there')
    if not any(first_line.lower().startswith(g) for g in valid_greetings):
        warn(f'Unusual greeting: "{first_line}" — expected Hi/Dear/Hello [Name],')


def check_signoff(body):
    lines = [l.strip() for l in body.split('\n') if l.strip()]
    # Check last few lines for Best regards
    tail = ' '.join(lines[-5:]).lower()
    if 'best regards' not in tail:
        error('Missing sign-off — email must end with "Best regards,"')


def check_links(body):
    # Bare URLs mid-sentence (not on their own line or after a label)
    lines = body.split('\n')
    for i, line in enumerate(lines, 1):
        urls = re.findall(r'https?://\S+', line)
        for url in urls:
            # Check if it's a bare URL mid-sentence (surrounded by words)
            pattern = r'\w\s+' + re.escape(url) + r'\s+\w'
            if re.search(pattern, line):
                warn(f'Line {i}: bare URL mid-sentence — use labeled link format')
            # Check for http://
            if url.startswith('http://'):
                error(f'Line {i}: insecure URL found ({url}) — use https://')
            # Check for URL shorteners
            shorteners = ['bit.ly', 'tinyurl.com', 't.co', 'ow.ly', 'goo.gl']
            if any(s in url for s in shorteners):
                warn(f'Line {i}: URL shortener detected ({url}) — use full URL')


def check_tables(body):
    # Look for tab-separated or space-aligned "tables" that aren't proper markdown
    lines = body.split('\n')
    for i, line in enumerate(lines, 1):
        if '\t' in line and len(line.split('\t')) >= 3:
            warn(f'Line {i}: tab-separated data detected — use markdown table (| col | col |) instead')


def check_raw_code(body):
    # Detect possible unformatted command/path strings
    lines = body.split('\n')
    for i, line in enumerate(lines, 1):
        stripped = line.strip()
        # Looks like a command but not in a code block
        if re.match(r'^(npm|pip|git|curl|docker|kubectl|python|node)\s+\S+', stripped):
            warn(f'Line {i}: command-like string not in code block — wrap with ``` or <pre>')


def parse_draft(text):
    lines = text.split('\n')
    subject_line = None
    body_start = 0
    for i, line in enumerate(lines):
        if line.lower().startswith('subject:'):
            subject_line = line
        elif line.strip() == '' and subject_line is not None:
            body_start = i + 1
            break
    body = '\n'.join(lines[body_start:])
    return lines, body


def main():
    parser = argparse.ArgumentParser(description='Validate email draft formatting')
    parser.add_argument('--input', help='Input draft file')
    parser.add_argument('--stdin', action='store_true')
    args = parser.parse_args()

    if args.stdin or not args.input:
        text = sys.stdin.read()
    else:
        with open(args.input, 'r') as f:
            text = f.read()

    lines, body = parse_draft(text)

    check_subject(lines)
    check_greeting(body)
    check_signoff(body)
    check_links(body)
    check_tables(body)
    check_raw_code(body)

    total = len(ERRORS) + len(WARNINGS)
    if total == 0:
        print('  [OK] All checks passed.')
        sys.exit(0)
    else:
        if ERRORS:
            print(f'Errors ({len(ERRORS)}):')
            print('\n'.join(ERRORS))
        if WARNINGS:
            print(f'Warnings ({len(WARNINGS)}):')
            print('\n'.join(WARNINGS))
        sys.exit(1)


if __name__ == '__main__':
    main()
