---
id: prompt_discovery
label: Prompt discovery
group: demand
order: 4
version: 5
output_kind: prompt_portfolio
description: Create or improve the buyer questions tracked in AI visibility engines from CiteLadder business, demand and competitor evidence. Use for prompt portfolios, prompt quality audits and topic coverage; not ordinary task-prompt writing.
---

# Buyer prompt discovery

## Goal

Propose realistic, non-leading buyer questions worth tracking in the project's AI engines, so CiteLadder measures whether real buyers discover, compare and choose the business. You only propose questions; the user reviews and accepts them in Prompts. Nothing is tracked until they do.

**Generate prompts** in Prompts already covers the broad market. This skill is a focused dive into a niche the user names: an offering, a place, a persona, a constraint or an intent. If the request does not name a niche, ask in the coverage plan rather than covering the whole market again.

## Inputs

- `get_project_business_context` for offers, buyers, language and served markets. Add geography only when the user targets a market or the business is local or regional.
- `read_prompt_portfolio` for existing prompts and the topic list. Page through it before claiming a duplicate or a gap; active prompts are capped at 50.
- Optional demand evidence: Search Console queries (`read_performance` with `dimension: query`), keyword data (`read_search_intelligence`, `read_search_dataset`), current AI answers (`read_visibility_results`).

With no demand evidence, the portfolio is a hypothesis; say so. Never attach keyword search volume to a prompt as "AI prompt volume". Private customer wording may inspire a question but is not quoted without approval.

### Topics

`read_prompt_portfolio` returns `topics`, the topic list for this project, including topics with no questions yet. Keep every returned topic and use only those topic IDs; never invent one. If `topics_truncated` is true, say the topic list is partial and work with the topics returned; do not repeat the read with a larger limit. If no topics exist, ask the user to generate starting topics in Prompts before submitting.

## Method

1. **Map the decision first:** audience → problem → offer → topic → buying stage and intent → constraints that really change the choice. A business with several offers needs offer-specific questions, not one question with nouns swapped.
2. **Use three separate groups:**
   - **Unbranded core:** questions where a good answer would naturally name or compare providers, without mentioning the target brand. Only these go in the submission block.
   - **Branded diagnostics:** questions naming the brand (pricing, limits, comparisons). Its mention rate is not evidence of discovery.
   - **Informational diagnostics:** practical questions where citing the brand's content would be valuable, tied to a commercial task.
3. **Test each question:** true to confirmed offers and markets; something a buyer would naturally ask (no SEO jargon, no flattery); could change a shortlist or purchase; clear without artificial detail; distinct from the others; evidence status known (observed, grounded expansion, or hypothesis).
4. **Reject** leading questions ("Why is [brand] the best?"), checklist questions no buyer would ask, arbitrary year additions, and questions picked only because the brand already wins. A question where the brand is absent is often exactly the gap to track.
5. **Size.** A requested count is a target, not permission to pad. Without one, propose the smallest useful starter set (often 12–20) and explain the choice.
6. **Existing prompts.** Recommend keep, revise or archive only when useful. A reworded prompt is a new question; it does not rewrite past results.

Place, persona or constraint wording belongs in a question only when it is the niche being targeted; record it in that row's `targeting`.

## Deliver

Answer questions about prompts or coverage directly without saving a document; do not create another coverage plan just because this skill is loaded.

### First: the coverage plan (outline)

A short plan the user edits and approves; no questions yet. For each topic, one line per buyer decision worth tracking (who is deciding what, under which constraint) and how many questions you intend. Then the assumptions you made and, only when an answer would change the plan, at most three focused questions. No evidence tables, IDs or method narration.

### After approval: the question portfolio

Write the questions the approved plan asked for, honouring the user's edits. The readable body contains:

1. The questions grouped by topic. For each: the question, its buying stage, and one short line on the decision it tracks and why (say "hypothesis" when no observed demand supports it).
2. Meaningful gaps and anything left out on purpose, briefly.
3. One line on next steps: review the questions in Prompts; nothing is tracked until the user accepts them there.

Branded and informational diagnostics, and keep/revise/archive notes for existing prompts, are short separate lists only when useful. No IDs or data tables in the readable body.

For the **Review in Prompts** action, include exactly one fenced `json` block
at the end of the body with this shape (replace the topic ID with a returned
UUID); the app hides it from the readable view:

```json
{
  "prompts": [
    {
      "topic_id": "<existing-topic-uuid>",
      "text": "A natural question expressing one useful buyer decision",
      "buyer_stage": "consideration",
      "prompt_intent": "recommend"
    },
    {
      "topic_id": "<existing-topic-uuid>",
      "text": "A question written for the targeted niche",
      "buyer_stage": "decision",
      "prompt_intent": "buy",
      "targeting": { "place": "the targeted place" }
    }
  ]
}
```

Include only new unbranded core questions in that block, at most 50.
Valid buyer stages: {{buyer_stages}}.
Valid prompt intents: {{prompt_intents}}.
`targeting` is optional and takes only these keys: {{prompt_targeting_keys}}. Include it
only when the question was written for that niche, with the value it targets.
Do not invent topic IDs or add other keys to these submission rows. The user submits
this saved revision for admission and quality checks, then explicitly accepts
candidates in Prompts. Submission never activates tracking.

Suggest AI visibility diagnosis for analysing results, Search opportunities for content ideas, and Measure results for baselines.
