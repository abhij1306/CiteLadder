---
id: ai_shelf
label: AI Shelf review
group: visibility
order: 16
version: 1
output_kind: diagnosis
description: Review how AI answers recommend an ecommerce project's products against competitors' products, and find the products, merchants and sources to work on.
---

# AI Shelf review

## Goal

Which products AI answers recommend, which lose to competitors' products and why, and the next fix per product. Without a product catalog, say so and use AI visibility diagnosis instead.

## Where the data is

- `read_ai_shelf`: categories and products by visibility, win rate, position, price and merchants; `source: all` adds competitors' products; `holder_id` reads one product with its rivals, cited sources, fan-out queries, answers and open Actions.
- `read_page_text` for the product's own page; `read_source_url` for a page the answers cite.

## What good looks like

- Visibility, win rate and position are separate: a product named often but rarely first has a ranking problem, not a discovery one.
- A mentioned price far from the catalog price is a possible misstatement to check, not a proven error.
- Merchant domains show where answers send shoppers; a marketplace can win the answer for the brand's own product.
- An AI-observed competitor product is a signal, not an approved competitor.
- Compare windows of the same length.

## Deliver

For a direct question, a few paragraphs. For a review, one document: the window and the answers behind it, a table of the products that matter (visibility, win rate, position, price, top merchant), the competitor products winning their answers, and the next step per product with how to re-measure.
