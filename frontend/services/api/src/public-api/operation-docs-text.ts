export const OPERATION_TEXT = `
GET /v1/projects | List projects | Returns the projects the key can reach, one page at a time. A key limited to some projects lists only those. Start here to find the project_id every other path needs.
GET / | Get a project | Returns one project: its brand, website, markets, owned domains, competitors, prompt sets and the defaults its audits start from. A project outside the key's reach answers 404.
GET /markets | List markets | Lists the markets a project measures, each a country and language pair. The default market is flagged, and visibility reads that take a market filter accept these ids.
GET /business-map | Get the business map | Returns the project’s business map: the offerings CiteLadder found for the business and those still available to add.
GET /prompt-sets | List prompt sets | Lists the project’s prompt sets. A prompt set is the group of prompts an audit runs together.
GET /prompt-sets/{prompt_set_id} | Get a prompt set | Returns one prompt set with its prompts. Each prompt carries its latest measurement, which is measured, not measured or unavailable; none of these is zero.
GET /prompt-sets/{prompt_set_id}/candidates | List prompt candidates | Lists the candidate prompts a generation run proposed and nobody has accepted or rejected yet. Review them with the candidate review operation.
GET /prompt-sets/{prompt_set_id}/generation-runs | List prompt generation runs | Lists the prompt generation runs of a prompt set, newest first, one page at a time.
GET /prompts | List prompts | Lists the project’s prompts, one page at a time. Filter by prompt set, topic or status. Each prompt carries its latest measurement, which is measured, not measured or unavailable.
GET /topics | List topics | Lists the topics that organise the project’s prompts, including nested topics.
GET /competitors | List competitors | Lists the competitors the project tracks, with the names, aliases and domains used to recognise them in answers.
GET /competitor-suggestions | List competitor suggestions | Lists companies that are not tracked competitors yet, found by a domain AI answers cited (kind cited_domain) or a name they used (kind named_in_answers), one per domain or name. Accept one to start tracking it, or reject it so it is never suggested again.
GET /audits | List audits | Lists the project’s audits, newest first, one page at a time.
GET /audits/{audit_id} | Get an audit | Returns one audit with its status and progress. A launched audit is queued and runs on its own, so poll this to see it finish.
POST /audits/estimate | Estimate an audit | Returns the number of answers an audit would ask for and its maximum attempt count, without creating anything. Pass the maximum as max_attempts when launching to cap the cost. It needs only the read scope.
GET /audit-schedules | List audit schedules | Lists the schedules that launch the project’s audits automatically.
GET /audit-schedules/{schedule_id} | Get an audit schedule | Returns one audit schedule with its cadence, time zone and engines.
GET /visibility | Get visibility | Returns the visibility projection for a selection of audits, optionally compared with a baseline. Filter by topic to read only answers to prompts filed under it when their run froze its topics. Each brand in rankings carries its win rate, average position and net sentiment. Rates are null when a run could not determine them; null is not zero.
GET /visibility/prompts | List prompt metrics | Returns per-prompt visibility metrics for a selection: mention and citation rates, share of voice, average position, win rate, the brand’s sentiment, how often answers searched the web, and the sources and brands the answers named. A web search share is null when no engine reported search use, which is not 0%.
GET /visibility/prompts/{prompt_id}/history | Get a prompt’s history | Returns how one prompt’s visibility changed across audits.
GET /visibility/trends | Get visibility trends | Returns visibility over time for the project, bucketed by the granularity you choose. Filter by market, topic, engine, model, retrieval and cohort. Each point lists the events behind a change: a prompt panel change, an engine model change or an Action going live.
GET /visibility/fanout | Get query fan-out | Returns the follow-up searches AI engines ran while answering your prompts, grouped by query, with the answers that used them. Each query has its share of the query occurrences, its change since the previous comparable run (null when not compared) and the tracked brands it names. order is top, rising or falling; search narrows the queries by text.
GET /visibility/sources | List cited sources | Lists the domains and pages AI answers cited, with how often and whether each is owned, a competitor or a third party. Filter by topic, and use as_of to read a past selection.
GET /visibility/markets | List visibility markets | Lists the markets that have visibility data, for the market filter of the other reads. Filter by topic to list only markets with answers in it.
GET /visibility/ads | List ads in answers | Lists the ads that appeared in AI answers for a selection, with a summary of the creatives and the answers they appeared in. Filter by topic.
GET /visibility/perception | Get answer perception | Returns how AI answers describe the brand and its competitors for a selection of audits: themes with the quotes behind them, and sentiment by engine, topic, prompt and over time. Each sentiment carries its classified count; the app shows a figure only from 20 classified mentions.
GET /visibility/answers | List answers | Lists the answers of a selection of audits, newest first: each answer’s prompt, engine and model, the searches it ran, the brands it mentioned and the pages it cited. Pass audit_id for one run’s answers, and filter by prompt, outcome, competitor, domain or URL.
GET /prompts/{prompt_id}/answers | List a prompt’s answers | Lists every successful answer one prompt got across runs in one market, newest run first, one page at a time: the engine, the brands named in order, your position, whether you were cited and whether the engine searched the web. Without market it reads the project’s default market; pass market to read another. Filter by engine, date, brand named, cited and search use.
GET /site-health | Get Site Health | Returns the Site Health dashboard for a crawl: scores, issue counts and what changed since the crawl before it. Pass crawl_id to read an earlier crawl.
GET /site-crawls/{crawl_id}/pages | List crawled pages | Lists the pages one site crawl found, one page at a time, with filters for status, page kind and monitoring.
GET /site-crawls/{crawl_id}/issues | List Site Health issues | Lists the issue groups one crawl found, with severity, category and how many pages each affects.
GET /site-crawls/{crawl_id}/issues/{group_id} | Get a Site Health issue | Returns one issue group of a crawl with the pages it affects and the evidence for each.
GET /ai-traffic/overview | Get AI traffic overview | Returns visits from AI bots and assistants over a date range, split by purpose and verification status.
GET /ai-traffic/pages | List AI traffic pages | Lists the pages AI bots requested, with request counts, for a date range and filters.
GET /ai-traffic/coverage | Get AI traffic coverage | Returns how completely each log source collected AI traffic over a date range: coverage per reporting date with batch and heartbeat counts, and each source’s collection state. Per-page requests are in the AI traffic pages list.
GET /performance | Get performance | Returns search performance for a date range, optionally compared with another range, as a series and a selected snapshot.
GET /performance/table | Get the performance table | Returns the rows behind a performance snapshot for one dimension, one page at a time, optionally compared with another snapshot.
GET /search-intelligence/runs | List search intelligence runs | Lists the project’s search intelligence runs, newest first.
GET /search-intelligence/datasets/{dataset_id}/rows | List search dataset rows | Lists the rows of one search intelligence dataset, one page at a time, with sort, search and volume filters.
GET /actions | List actions | Lists the actions CiteLadder recommends, one page at a time. Filter by status, priority, approach, topic and more.
GET /actions/tree | Get the action tree | Returns the project’s actions grouped by goal and category, with the same filters as the list.
GET /actions/{action_id} | Get an action | Returns one action with its findings and the evidence behind them.
GET /actions/{action_id}/urls | List an action’s URLs | Lists the pages one action applies to, one page at a time.
GET /urls/{site_url_id}/actions | List a URL’s actions | Lists the actions that apply to one page of the site.
POST /prompt-sets/{prompt_set_id}/prompts | Create prompts | Adds a batch of prompts to a prompt set and returns the created prompts.{key}
POST /prompt-sets/{prompt_set_id}/generate | Generate prompts | Asks CiteLadder to propose new prompts for a prompt set, optionally for chosen topics. The proposals arrive as candidates to review; nothing is added to the prompt set until you accept them.{key}
POST /prompt-sets/{prompt_set_id}/import | Import prompts | Imports a list of prompts into a prompt set and returns the updated set.{key}
POST /prompt-sets/{prompt_set_id}/candidates/review | Review prompt candidates | Accepts or rejects candidate prompts by id. Accepted candidates become prompts of the set.{key}
PATCH /prompts/{prompt_id} | Update a prompt | Changes a prompt’s text, classification, topic, status (active or archived) or whether it runs. This is how to activate, archive or refile a prompt. Send only the fields to change; the updated prompt is returned.
DELETE /prompts/{prompt_id} | Delete a prompt | Deletes a prompt from its prompt set. Answers already recorded for it stay in past audits.
POST /prompt-sets/{prompt_set_id}/prompts/bulk-status | Activate or archive prompts | Sets the status of up to 500 prompts of one prompt set to active or archived in one change, and returns the updated set. Every id must be a prompt of that set, or nothing changes. Activation is refused when a prompt does not fit its topic or the plan has no prompt slots for it.{key}
POST /prompts/bulk-topic | File prompts under a topic | Files up to 500 of the project’s prompts under one topic in one change; topic_id null takes them out of every topic. Past runs keep the topic they froze. Every id must be a prompt of the project, or nothing changes, and an active prompt that does not fit the topic refuses the whole change. Returns how many prompts were filed.{key}
POST /prompts/bulk-delete | Delete prompts | Deletes up to 500 of the project’s prompts in one change. Every id must be a prompt of the project, or nothing is deleted. Answers already recorded stay in past audits. Returns how many prompts were deleted.{key}
POST /topics | Create a topic | Creates a topic, optionally under a parent topic, and returns it.{key}
PATCH /topics/{topic_id} | Update a topic | Renames a topic, changes its description or moves it under another parent.
DELETE /topics/{topic_id} | Delete a topic | Deletes a topic. Its prompts are kept.
POST /competitors | Add a competitor | Starts tracking a competitor by name, aliases and domains, and returns it.{key}
PATCH /competitors/{competitor_id} | Update a competitor | Changes a competitor’s name, aliases or domains. Send only the fields to change.
DELETE /competitors/{competitor_id} | Remove a competitor | Stops tracking a competitor. Answers already recorded keep what they found.
POST /competitor-suggestions/{candidate_id}/accept | Accept a competitor suggestion | Turns a suggested company into a tracked competitor and returns the competitor. A suggestion already rejected answers 409.{key}
POST /competitor-suggestions/{candidate_id}/reject | Reject a competitor suggestion | Dismisses a suggested company and returns the suggestion as rejected. Later audits never suggest that domain or name again. A suggestion already accepted answers 409.{key}
POST /audits | Launch an audit | Queues an audit of a prompt set, or of chosen prompts, on the engines you name, and returns the created audits. Each recorded answer spends one prompt run; set max_attempts to cap the spend, and estimate first with the estimate operation.{key}
POST /audits/{audit_id}/cancel | Cancel an audit | Stops an audit that has not finished and returns it. Answers already recorded are kept.{key}
POST /audit-schedules | Create an audit schedule | Creates a schedule that launches audits of a prompt set on a cadence and returns it.{key}
PATCH /audit-schedules/{schedule_id} | Update an audit schedule | Changes a schedule’s prompt set, cadence, time zone or engines. Send only the fields to change.
DELETE /audit-schedules/{schedule_id} | Delete an audit schedule | Deletes a schedule. Audits it already launched are kept.
PATCH /actions/{action_id} | Update an action’s status | Moves one action to a new status and returns it.
POST /actions/status | Update many actions’ status | Moves several actions to one status, chosen by id or by a filter, and returns how many changed.{key}
POST /actions/{action_id}/declaration | Record an implementation | Declares that an action was implemented, so CiteLadder can measure its effect. A repeat of the same declaration returns the existing one with status 200.{key}
`;
