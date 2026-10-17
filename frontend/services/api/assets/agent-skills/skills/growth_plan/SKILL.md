---
id: growth_plan
label: Growth plan
group: strategy
order: 1
version: 2
output_kind: plan
description: Prioritize SEO and AI visibility opportunities using persisted CiteLadder evidence. Produce bounded growth plans and explicit next-step advice for specialist work.
---

# Growth plan

## Goal

Turn the business objective into a short, evidence-backed sequence of work, and point each item to the specialist skill that should do it next. No skill runs automatically; you suggest the next chat.

If the user only asks what data is available, answer with the data, dates and gaps, and stop. If the user asks for a reusable task prompt, write it without claiming it ran.

## Inputs

Start with `get_project_business_context` and `read_integration_status`. Then read only what the plan needs:

- Existing priorities: `read_actions` (pass `action_id` for one Action's evidence).
- Search performance: `read_performance` for the latest complete comparable period.
- AI visibility: `read_visibility_overview`.
- Site health: `read_site_health`.
- Demand: `read_demand`.

If no objective is given, infer a provisional one from the site's real call to action and say so. Ask only if different goals would change the plan.

## Method

1. **Frame it in one sentence:** "For [audience/market], improve [business outcome] by fixing [bottleneck]." Keep business results separate from leading signals like impressions, citations or rankings.
2. **Check the data first.** A disconnected source, incomplete import, changed prompt set or failed audit is a data problem, not a decline. Resolve or state it before reading zeros. Check for a sitewide access blocker before recommending more content.
3. **Map commercial relevance.** Find the real conversion pages (product, service, booking, lead, etc.) and link audience → offer → buyer task → topic → page. The homepage is not automatically the only money page.
4. **Route each bottleneck to its skill:**
   - Tracked buyer questions missing or unrepresentative → Prompt discovery.
   - Weak topic or keyword coverage, competitor gaps → Search opportunities.
   - Page or query demand not satisfied → Search Console optimization.
   - Access, canonical, rendering or indexing defect → Technical health.
   - Important pages poorly linked → Internal links.
   - Weak AI mentions, citations or recommendations → AI visibility diagnosis.
   - Third-party source or link gaps → Earned authority.
   - An accepted content idea → Create content, Comparison content or Programmatic SEO pilot.
5. **Pick a few actions.** Compare business fit, evidence strength, effort, dependencies and reversibility. Group them as now / next / later with reasons. A proven defect on a conversion path beats speculative content. A low-volume, high-fit task can beat a high-volume unrelated keyword. Do not estimate revenue without real conversion data.
6. **Sanity-check each action.** What would show it is the wrong problem, and what could it break? Note this briefly.
7. **Plan measurement.** Each action gets one primary outcome, a guardrail and a review date. If nothing is implemented yet, give a baseline, not a verdict.

When the plan shows the product's own Action ranking, keep it separate from your ordering and explain where yours differs.

## Deliver

One document with:

- Objective, market, dates, scope and key unknowns.
- The main bottlenecks the data supports (no more than the evidence justifies).
- A now / next / later table: target, the work, why (evidence in plain words), effort, dependency, how to check it worked. Usually no more than five "now" items.
- A content map only when asked.
- The next step: which skill to start in a new chat and a ready-to-paste request with the known pages and goals filled in.
- Measurement plan and the data gaps that block decisions.
