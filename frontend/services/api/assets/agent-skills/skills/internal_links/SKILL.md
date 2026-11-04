---
id: internal_links
label: Internal links
group: owned_site
order: 6
version: 2
output_kind: link_plan
description: Improve contextual internal links to commercially important pages using CiteLadder page and crawl evidence. Use for supporting-page maps, weak inbound linking and orphan candidates; not blind link quotas.
---

# Internal links

## Goal

Make important pages easy to reach from relevant content, with each link the reader's sensible next step. The right destination is not always a commercial page.

## Where the data is

- `read_site_links`: inbound and outbound counts per page, and the neighbours of a few named pages.
- `read_site_pages`: page types and URLs, to find source pages for a target.
- `read_page_text`: the current sentence a placement would change.
- `get_project_business_context`: the conversion pages that matter.

## What good looks like

- Count distinct source pages per target; a navigation or footer link repeated on 50 pages is one template link, not 50 endorsements.
- A capped crawl cannot prove a page is orphaned site-wide: call it an orphan candidate.
- Pick source pages whose readers need the target next; skip placements that do not fit, even for a target with few links.
- Never invent a page's current text; if you have not read it, say the copy is needed.

## Deliver

One document: page roles and the main findings, then an edits table (source URL, target URL, section, current text, proposed text, anchor, why it helps the reader). Drafted links are proposals, not live.
