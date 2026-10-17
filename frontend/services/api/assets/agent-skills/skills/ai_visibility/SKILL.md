---
id: ai_visibility
label: AI visibility diagnosis
group: visibility
order: 8
version: 3
output_kind: diagnosis
description: Diagnose why a brand is absent, weakly cited, misrepresented or not recommended in CiteLadder AI results. Use raw prompt/answer/source evidence to choose owned, earned, technical or prompt-quality work.
---

# AI visibility diagnosis

## Goal

Find where a relevant buyer question fails to produce a useful, accurate mention of the brand, and pick the next fix from the actual answers. Do not apply a generic "AEO checklist" or guess at a model's private ranking logic.

## Read the right data

1. `read_visibility_overview` for the latest completed run and its status. If it has no completed run, say there is no usable baseline.
2. `read_visibility_results` with that `audit_id` for the actual answers. Filter by `prompt_id`, `domain` or `url` to narrow. If a result only summarizes a record, open it with `fetch`.
3. `read_visibility_sources` (the same `audit_id`; it defaults to the latest run) for cited domains (`level: domain`) or URLs (`level: url` with `domain`).
4. As needed: `read_visibility_overview` for headline rates, `read_prompt_portfolio` for which prompts are tracked, `get_project_business_context` for offers and competitors.
5. For how answers portray the brand, `read_perception` with the same `audit_id` (`view: quotes` for the verified quotes): always state its coverage ("N of M mentions classified"); a pending or unavailable read has no value, never zero. Sources it lists were cited alongside criticism, never shown to cause it.
6. For ads in ChatGPT Search answers, `read_ai_ads` with the same `audit_id`: ads are paid placements; report them separately, never as citations, sources or a cause of visibility, and an engine without ads is not applicable, never zero.
7. For whether answers state the brand's facts correctly, `read_fact_checks` with the same `audit_id` (`view: claims` to page the claims). If it is `not_enabled`, skip it without comment. Always state its coverage, and quote the confirmed fact beside each contradicted claim. Inconclusive and not covered are gaps in the facts, not errors in the answer; sources it lists were cited alongside a contradiction, never shown to cause it.

Engines and surfaces are whatever the data shows; do not assume a fixed set. Keep `core` and `comparison` cohorts separate. A summary-only read supports only a summary-level finding. Report answers as unavailable only after the read fails or says they are absent.

## Diagnose

1. **Check the prompts first.** Separate unbranded discovery, branded and informational prompts. A high mention rate on prompts that name the brand does not prove discovery. Note failed runs and changes in prompt, engine or cohort mix.
2. **Read the decisive answers.** For each, note separately: cited, mentioned, recommended, recommended against, or misstated. A citation is not an endorsement; no citation does not prove the page was never retrieved. Check aliases, negation and context; a similar substring is not a mention.
3. **Look at sources.** Map cited domains and URLs to who controls them (owned, competitor, independent publisher, platform). A brand's own YouTube video is owned content, not independent validation. Count appearances per distinct prompt run with a stated denominator; one repeated prompt is not many buyer needs.
4. **Classify the failure:**
   - **Measurement problem:** weak, leading or noncommercial prompts, wrong market, failed runs. Fix the prompts before the content.
   - **Access problem:** a key owned page is shown to be blocked or broken. Absence from answers alone does not prove blocking.
   - **Answer gap:** owned content lacks the explanation, proof or decision detail. Name the page and what is missing.
   - **Source gap:** a frequently cited independent source covers alternatives but omits or misstates the brand.
   - **Fit gap:** the answer knows the brand but prefers another option. Check whether that limitation is real; never write false superiority claims.
   - **Volatility:** results differ across runs or engines. Look at repeated runs before calling one loss a trend.
5. **Compare competitors fairly.** Keep direct competitors apart from publishers. Look at what claims or criteria earn their inclusion, not just mention counts.
6. **Owned-page gaps.** `read_content_differentiation` returns up to 10 reports comparing an owned page with inspected organic results. Use the report for the relevant prompt if one is listed; if none is, treat the comparison as unavailable, not as parity. Quote any gap with its count out of pages inspected, and call a topic "unique" only within that inspected set. These are organic results, not AI citations.

## Rules

- No universal schema bonus, ideal paragraph length, "AI readiness" score or forecast.
- An answer without source URLs cannot support source-level analysis.
- For Google AI Overviews, separate "no AI Overview shown" from a provider error.
- Never drop valid losing answers to improve a rate.

## Deliver

For a direct question ("why are we missing?"), answer in a few paragraphs: what the answers actually show, the strongest next action, and the main remaining uncertainty.

For a full diagnosis, the document covers: what was measured (audit date, engines, prompt cohorts, coverage); outcomes by type; the failure types found, with the decisive answer excerpts; source and competitor gaps; prioritized actions; and how to re-measure on the same prompts and engines. When useful, add a table of key observations: prompt text, engine, date, mentioned, recommended, factual issue, short answer excerpt, cited URLs.

Suggest next steps by name: Prompt discovery for prompt gaps, Create content for owned answers, Earned authority for source gaps, Technical health for access defects, Measure results for follow-up.
