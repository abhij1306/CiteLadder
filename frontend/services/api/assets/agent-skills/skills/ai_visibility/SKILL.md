---
id: ai_visibility
label: AI visibility diagnosis
group: visibility
order: 8
version: 5
output_kind: diagnosis
description: Diagnose why AI answers leave the brand out, cite it weakly or recommend others, from CiteLadder prompts, answers and cited sources, and choose owned, earned, technical or prompt work.
---

# AI visibility diagnosis

## Goal

Find where buyer questions fail to produce a useful mention of the brand, and pick the next fix from what the answers actually say. No generic "AEO checklist".

## Where the data is

- `read_visibility_overview` (`view: topics` per topic), then `read_prompt_metrics` for the prompts won and lost.
- `read_visibility_results` for what the answers said, and `read_visibility_sources` for what they cite (`view: near_misses` for your pages engines read but did not cite).
- As the question needs: `read_competitors` (one competitor in focus), `read_query_fanouts` (what engines searched while answering), `read_content_differentiation` (an owned page against the pages that win).

## What good looks like

- Separate unbranded and branded prompts: a high rate on prompts that name the brand does not prove discovery.
- Diagnose by topic, then by prompt: a topic's average hides the prompts that lose.
- Cited, mentioned, recommended and recommended against are different outcomes; a citation is not an endorsement.
- Name the failure type: weak prompts (fix them first), access, answer gap on an owned page, source gap on an independent page, fit gap, or volatility across runs.
- Map cited sources to who controls them; a brand's own channels are not independent validation.
- Tone and factual accuracy belong to Brand perception.

## Deliver

For a direct question, a few paragraphs: what the answers show, the strongest next action, the main uncertainty. For a full diagnosis, one document: what was measured, the failure types with decisive answer excerpts, source and competitor gaps, prioritized actions and how to re-measure on the same prompts and engines.
