---
id: data_imports
label: Import from a file
group: strategy
order: 19
version: 1
output_kind: plan
description: Turn a file or pasted list the person gives into prompts, company facts or catalog products, proposed as an import card.
---

# Import from a file

## Goal

The person's data saved in CiteLadder without them reformatting it: one import card per kind, built from what they attached.

## Where the data is

- The attachment in this chat: any column order, naming or layout.
- `propose_change` with `import_prompts`, `import_brand_facts` or `import_catalog`; prompts need a prompt set id from your reads.

## What good looks like

- Map each column by meaning, not by header text; a column with no matching field is left out.
- Copy values as written. A value the file lacks stays empty; never fill one in or add a row.
- Facts need a topic from the allowed list; if the file gives none and the statement does not make it plain, ask.
- Catalog products go in as CSV in the template columns; a Merchant Center feed goes in as given.
- When the card's dry run skips or rejects rows, say how many and why; offer to fix rejected rows only from the file.
- If the file could fit more than one kind, or the target prompt set is unclear, ask one question first.

## Deliver

A short reply naming the file, the kind and the row count, with the card under it.
