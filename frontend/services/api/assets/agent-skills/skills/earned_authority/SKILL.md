---
id: earned_authority
label: Earned authority
group: visibility
order: 9
version: 2
output_kind: earned_brief
description: Find legitimate third-party citation, mention and backlink opportunities using CiteLadder source and competitor evidence. Produce source-specific pitches, corrections or linkable-asset plans; never bulk spam or automatic outreach.
---

# Earned mentions, backlinks and source opportunities

## Goal

Pick a short list of attainable, relevant third-party opportunities and write usable drafts for them. A few well-chosen prospects beat a list of famous domains.

## Inputs

You need verified business facts (`get_project_business_context`) and at least one of:

- Sources cited in AI answers: `read_visibility_sources`, `read_visibility_results`, and `read_source_url` for one page's prompts and the brands it lists.
- Backlink datasets: `read_search_intelligence`, then `read_search_dataset`. These are referring-domain and destination-page totals, not individual links; never describe a specific linking page or anchor from them.
- A prospect list the user supplies.

You cannot browse, so you cannot check live pages, find contacts or confirm a link exists.

## Keep outcomes separate

A live backlink, an unlinked mention, a cited source that names the brand, and an independent recommendation are different things. An owned social profile is not independent evidence.

## Method

1. **Build a typed prospect pool:** recurring AI-cited sources, competitor referring domains, unlinked mentions, lost or broken links, directories and associations, editors and reviewers, communities, research partners. Remove duplicates and syndicated copies.
2. **Judge fit, not just authority.** Topic fit, audience, editorial independence and whether inclusion is realistic matter more than a provider authority score, which is only an estimate.
3. **Pick the right move for each prospect:**
   - **Correction:** the source states something false or outdated; offer the fact and its proof.
   - **Editorial inclusion:** the brand meets the source's criteria; pitch the useful addition, not a link.
   - **Link reclamation:** an existing mention or broken link; suggest the right destination page.
   - **Expert contribution:** only with real, available expertise; never invent a quote or interview.
   - **Original asset:** research, data or a tool worth citing; plan it before claiming results.
   - **Community answer:** answer a real question, disclose the relationship, follow the rules; skip the link if it is not needed.
   - **Reference correction:** use the disclosed request process for encyclopedic sites, never covert edits.
4. **Write the drafts.** Name the exact article and the value offered. Use the real sender only if provided; otherwise a clearly marked placeholder. For contacts, name the route to look for (author page, contribution guidelines, contact form); never guess names or emails.
5. **Prioritize.** A small pilot batch ordered by fit, value to readers, effort and risk.

## Rules

- No bought links, link networks, fake reviews, required positive sentiment or manufactured community consensus. Paid sponsorship is labelled as such.
- A low provider score does not prove a harmful link; never recommend automatic disavows.
- A competitor appearing on a source does not prove the source caused its recommendation. A new link does not prove an AI visibility gain.
- Sending, posting and follow-ups are the user's actions.

## Deliver

One document with:

- **Plan:** the opportunity types found and why the shortlist was chosen.
- **Prospects table:** source URL, publisher, type, buyer question it serves, what was observed (with dates), competitors seen, brand presence, proposed action, destination page, proof needed, contact route to look for, priority reason.
- **Drafts:** one complete draft per selected prospect, or the missing fact that blocks it.
- **Rejected prospects** with a one-line reason, and an original-asset brief if the brand lacks something worth citing.

Suggest Create content for missing assets, Comparison content for competitive facts, and Measure results for follow-up.
