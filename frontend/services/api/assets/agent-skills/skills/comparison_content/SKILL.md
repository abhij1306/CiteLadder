---
id: comparison_content
label: Comparison content
group: content
order: 11
version: 3
output_kind: content
description: Research and write honest product, service or provider comparisons and alternatives pages grounded in CiteLadder buyer demand and verified claims. Use for named competitors, not fabricated superiority or neutral-looking promotion.
---

# Comparison and alternatives content

## Goal

Write a comparison that helps a real buyer decide. The sponsoring brand may be the best choice, a narrow-fit choice, or the wrong fit for some needs; say so honestly.

## How the work flows

- Answer questions about the draft directly, without saving a new document.
- Choose the format: usually `comparison` (set `format_id`). It is long-form, so first deliver an outline (the decision, the criteria, the options, the sections) for the user to approve, then write the full page. Edit the current document when the user asks for changes.
- Research only the named comparison. Do not turn it into a full competitor survey.

## Inputs

You need the actual options being compared, the buyer and market, and facts about each option. Get company facts from `get_project_business_context`. Useful extras: buyer questions from tracked prompts and AI answers (`read_visibility_results` with an `audit_id` from `read_visibility_overview`), search demand (`read_performance` with a `dimension`, `read_search_dataset`), and existing owned pages. You cannot check the live web, so use only facts already saved or supplied by the user.

## Method

1. **Frame the decision.** Who is choosing, for what use, under which constraints, and where the options actually overlap. If the publisher is one of the options, make that clear on the page.
2. **Check existing coverage.** Update an existing comparison page rather than creating a near-duplicate.
3. **Set the same criteria for every option.** Use what matters to the buyer (fit, capabilities, service model, total cost, setup, limits, compatibility, availability). Do not pick trivial criteria the sponsor wins.
4. **Use dated facts only.** Keep each fact's date. For prices, keep currency, billing period, commitment and add-ons. Unknown is not "missing", "free" or "worse". Absence from one page does not prove a feature is missing. Leave unverified facts out of the page and list them in the editorial notes.
5. **Handle reviews carefully.** Attribute reported experiences; never invent ratings, quotes or hands-on tests.
6. **Give fit guidance.** "Choose X if…" for each option, including the sponsor's real limits. If the evidence cannot support an overall verdict, give a factual table and conditional guidance instead.
7. **Check fairness.** Would a buyer who picks the competitor feel fairly represented? Remove implied guarantees and unsupported claims.

## Deliver

One document with:

- **The page:** title, short decision summary, comparison table built only from supported facts (no unsupported checkmarks), the differences that matter, pricing context, when to choose each option, and an honest call to action. For an alternatives list, include only options that genuinely fit and say how they were chosen.
- **Editorial notes:** a claim table (criterion, each option's claim, its source and date, qualifiers), facts still needing an official source, and which facts will go stale and when to recheck. Do not add a fake "updated" date.

Suggest Internal links for linking the page in, and Measure results for follow-up.
