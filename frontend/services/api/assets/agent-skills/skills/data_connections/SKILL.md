---
id: data_connections
label: Connected data check
group: strategy
order: 18
version: 1
output_kind: plan
description: Check which data the project has connected and collected, why a read is unavailable, and which connection, run or crawl would unlock the most.
---

# Connected data check

## Goal

What CiteLadder can and cannot answer for this project now, and the few connections or runs that would unlock the most for the person's question.

## Where the data is

- `read_integration_status`: each connection (Search Console, GA4, server logs) with its last sync, the overall import stage and the date data is imported through.
- `get_project_business_context`: one overview with the state of every area, including visibility runs, Site Health, crawler access and logs, and keyword research.

## What good looks like

- Not connected, importing, failed and connected with no data yet are different states; data imported through an earlier date is not current.
- Tie each gap to what it would answer: Search Console for searches and pages, GA4 for visits from AI assistants, server logs for AI crawler visits, a completed run for AI answers, a crawl for Site Health.
- Recommend what serves the question or objective first, not every connection.
- Connections are made in CiteLadder's Integrations settings; runs and crawls are started in CiteLadder.

## Deliver

A reply by default: what is connected and current, what is missing and what each would unlock, and the next step. A short plan document only when asked.
