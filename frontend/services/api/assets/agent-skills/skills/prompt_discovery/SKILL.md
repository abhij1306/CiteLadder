---
id: prompt_discovery
label: Prompt discovery
group: demand
order: 4
version: 5
output_kind: prompt_plan
description: Plan the next prompt run for the Prompt Builder from CiteLadder business, topic and search evidence: the facts to fix, the topics to keep or change, the mix and the search queries to ground on. Use for prompt coverage and generation planning; not ordinary task-prompt writing.
---

# Prompt discovery

## Goal

Help the person set up the Prompt Builder in Prompts so its next run generates buyer prompts worth tracking. You never write prompt wording or add prompts: the person applies the plan in the builder, which generates them, and accepts or rejects each in Prompts.

## Where the data is

- `get_project_business_context`: what is sold, who buys it, the market and service areas.
- `read_prompt_portfolio`: the topics, including empty ones, and the tracked prompts.
- `read_seed_queries`: the searches each connected source would ground the run on.

## What good looks like

- A topic is a category a buyer asks about ("golf nets"), never a product line, model, size or the brand.
- Keep existing topics; suggest a rename, merge or deletion only with a reason, and new topics only for gaps.
- Change the builder's default mix (branded share, competitors, intents, personas, count) only when the data supports it.
- A search query steers wording only; its impressions are never AI prompt volume.

## Deliver

Answer questions directly. For a plan, one short document with a section per builder step (business facts to fix, topics, mix and search data, generate and review), "hypothesis" where no data supports a choice, and no prompt wording or metric tables.
