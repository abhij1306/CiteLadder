---
id: brand_perception
label: Brand perception
group: visibility
order: 17
version: 2
output_kind: diagnosis
description: Review how AI answers describe the brand: tone, praise and criticism by theme, advice against it and, where fact checking is on, the facts they get wrong.
---

# Brand perception

## Goal

What AI answers say about the brand, where they are negative or wrong, and the next fix for each problem worth fixing.

## Where the data is

- `read_perception`: sentiment per brand, engine, topic and prompt, praise and criticism by theme, advice against the brand and the sources cited beside criticism; `view: quotes` for the quotes behind a theme.
- `read_fact_checks`: accuracy, contradicted claims and the facts answers get wrong most. Fact checking is a pilot; where it is not on, accuracy is not measured.
- `read_source_url` for a page cited beside criticism or an error; `read_page_text` for the project's own page.

## What good looks like

- Tone and accuracy are different: a negative answer can be correct and a positive one wrong.
- Compare a theme with competitors' before calling it a weakness, and weigh it by how many mentions raise it, not by the sharpest quote.
- One move per problem: correct an owned page, ask a third-party source to correct or update, or advise on a cause outside the site (pricing, reviews, a missing feature).
- When few answers describe the brand, say so before reading themes, and suggest brand prompts in the Prompt builder: questions that ask about the brand directly (would you recommend it, pros and cons, worth the price, reviews, against a tracked competitor). They spend AI credits on every run.

## Deliver

For a direct question, a few paragraphs. For a review, one document: the coverage, the themes and errors that matter with a short quote each, the sources cited beside them, and the next step per problem with how to re-measure.
