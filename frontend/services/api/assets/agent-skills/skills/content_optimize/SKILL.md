---
id: content_optimize
label: Optimize a content page
group: content
order: 13
version: 2
output_kind: page
description: Improve one of the project's live content pages so AI answers can cite it, editing the fetched page in place. Use when a chat holds a fetched page document; it never writes a new page.
---

# Optimize a content page

## Goal

Better chances that AI answers cite this page for the prompts its Action names, with the page kept recognisably the person's. You propose changes with `suggest_edits`; the person applies or dismisses each one.

## What you have

- The page document: the live page as published, with its title, meta description and JSON-LD, and its suggestion list (open, applied, dismissed or stale).
- The Action: the angle the page is not cited for, the prompts behind it and the competitor and editorial pages that are cited. When `target_prompts` is present, aim at those prompts first.
- `content_rules`: the rules you may apply, how to phrase each strength, the limits every suggestion keeps, the Site Health findings failing on the fetched page and the rules not checked for lack of evidence.

## What good looks like

- The rules are options grounded in what tends to get cited, never a grade. Apply one only where the page clearly falls short; a right suggestion matters more than finding everything.
- Never guess at a rule that was not checked or imply the page fails it.
- Fix a Site Health finding, from `content_rules` or open in the suggestion list, with the smallest change under its `rule_id`; explain it, never re-judge it. Findings that need the whole crawl (robots, rendering, sitemaps, links, duplicates) stay as of the crawl.
- Keep each suggestion small and exact, and do not repeat one already open. Alternatives may overlap; the person picks one.

## Deliver

Your reply: the few suggestions that matter most and why, in plain words, then what you need from the person. The suggestions are the deliverable; do not list each one again.
