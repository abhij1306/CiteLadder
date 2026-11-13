-- Indexes and constraints.
-- Forward-only and applied in place. The runner applies every pending file in
-- one transaction, so CREATE INDEX CONCURRENTLY is unavailable: each index
-- below is built with a plain CREATE INDEX, which blocks writes to its table
-- for the build. Dropped indexes are redundant or replaced in this file; no
-- running query depends on one by name.

-- 1. Set-null references. PostgreSQL clears each reference with one
--    lookup per deleted parent row, so an unindexed one scans its whole table,
--    every tenant included, per deleted crawl, audit, prompt, snapshot or
--    connection. Scheduled crawls and audits (0029) end migration 0018's
--    premise that those parents stay few per project. Each index covers set
--    rows only: the lookup's equality implies IS NOT NULL. User actor
--    references stay unindexed: a user is deleted only while owning nothing.

CREATE INDEX ix_actions_opportunity_snapshot_id ON public.actions
    USING btree (opportunity_snapshot_id) WHERE opportunity_snapshot_id IS NOT NULL;
CREATE INDEX ix_actions_target_prompt_id ON public.actions
    USING btree (target_prompt_id) WHERE target_prompt_id IS NOT NULL;
CREATE INDEX ix_agent_messages_reply_to_message_id ON public.agent_messages
    USING btree (reply_to_message_id) WHERE reply_to_message_id IS NOT NULL;
CREATE INDEX ix_agent_output_revisions_message_id ON public.agent_output_revisions
    USING btree (message_id) WHERE message_id IS NOT NULL;
CREATE INDEX ix_agent_output_revisions_parent_revision_id ON public.agent_output_revisions
    USING btree (parent_revision_id) WHERE parent_revision_id IS NOT NULL;
CREATE INDEX ix_agent_output_revisions_run_id ON public.agent_output_revisions
    USING btree (run_id) WHERE run_id IS NOT NULL;
CREATE INDEX ix_aio_observations_provider_connection_id ON public.aio_observations
    USING btree (provider_connection_id) WHERE provider_connection_id IS NOT NULL;
CREATE INDEX ix_audit_engine_snapshots_connection_id ON public.audit_engine_snapshots
    USING btree (connection_id) WHERE connection_id IS NOT NULL;
CREATE INDEX ix_audit_prompt_snapshots_prompt_id ON public.audit_prompt_snapshots
    USING btree (prompt_id) WHERE prompt_id IS NOT NULL;
CREATE INDEX ix_audit_tasks_provider_connection_id ON public.audit_tasks
    USING btree (provider_connection_id) WHERE provider_connection_id IS NOT NULL;
CREATE INDEX ix_brand_discoveries_initial_crawl_id ON public.brand_discoveries
    USING btree (initial_crawl_id) WHERE initial_crawl_id IS NOT NULL;
CREATE INDEX ix_commerce_competitor_candidates_attempt_id ON public.commerce_competitor_candidates
    USING btree (attempt_id) WHERE attempt_id IS NOT NULL;
CREATE INDEX ix_commerce_recommendation_observations_product_id
    ON public.commerce_recommendation_observations
    USING btree (product_id) WHERE product_id IS NOT NULL;
CREATE INDEX ix_commerce_recommendation_observations_candidate_id
    ON public.commerce_recommendation_observations
    USING btree (competitor_candidate_id) WHERE competitor_candidate_id IS NOT NULL;
CREATE INDEX ix_demand_snapshots_prior_snapshot_id ON public.demand_snapshots
    USING btree (prior_snapshot_id) WHERE prior_snapshot_id IS NOT NULL;
CREATE INDEX ix_integration_events_grant_id ON public.integration_events
    USING btree (grant_id) WHERE grant_id IS NOT NULL;
CREATE INDEX ix_opportunities_target_prompt_id ON public.opportunities
    USING btree (target_prompt_id) WHERE target_prompt_id IS NOT NULL;
CREATE INDEX ix_opportunity_snapshots_audit_id ON public.opportunity_snapshots
    USING btree (audit_id) WHERE audit_id IS NOT NULL;
CREATE INDEX ix_opportunity_snapshots_site_crawl_id ON public.opportunity_snapshots
    USING btree (site_crawl_id) WHERE site_crawl_id IS NOT NULL;
CREATE INDEX ix_opportunity_snapshots_demand_snapshot_id ON public.opportunity_snapshots
    USING btree (demand_snapshot_id) WHERE demand_snapshot_id IS NOT NULL;
CREATE INDEX ix_opportunity_verification_events_crawl_id ON public.opportunity_verification_events
    USING btree (crawl_id) WHERE crawl_id IS NOT NULL;
CREATE INDEX ix_opportunity_verification_events_audit_id ON public.opportunity_verification_events
    USING btree (audit_id) WHERE audit_id IS NOT NULL;
CREATE INDEX ix_prompt_candidates_prompt_id ON public.prompt_candidates
    USING btree (prompt_id) WHERE prompt_id IS NOT NULL;
CREATE INDEX ix_provider_capacity_buckets_connection_id ON public.provider_capacity_buckets
    USING btree (connection_id) WHERE connection_id IS NOT NULL;
CREATE INDEX ix_query_evidence_snapshots_supersedes_snapshot_id ON public.query_evidence_snapshots
    USING btree (supersedes_snapshot_id) WHERE supersedes_snapshot_id IS NOT NULL;
CREATE INDEX ix_search_intelligence_runs_previous_run_id ON public.search_intelligence_runs
    USING btree (previous_run_id) WHERE previous_run_id IS NOT NULL;
CREATE INDEX ix_site_change_snapshots_supersedes_id ON public.site_change_snapshots
    USING btree (supersedes_id) WHERE supersedes_id IS NOT NULL;
CREATE INDEX ix_site_urls_first_seen_crawl_id ON public.site_urls
    USING btree (first_seen_crawl_id) WHERE first_seen_crawl_id IS NOT NULL;
CREATE INDEX ix_site_urls_last_seen_crawl_id ON public.site_urls
    USING btree (last_seen_crawl_id) WHERE last_seen_crawl_id IS NOT NULL;
CREATE INDEX ix_source_page_inspection_spend_source_page_id
    ON public.source_page_inspection_spend
    USING btree (source_page_id) WHERE source_page_id IS NOT NULL;
CREATE INDEX ix_source_page_snapshots_audit_id ON public.source_page_snapshots
    USING btree (audit_id) WHERE audit_id IS NOT NULL;
CREATE INDEX ix_source_pages_first_seen_audit_id ON public.source_pages
    USING btree (first_seen_audit_id) WHERE first_seen_audit_id IS NOT NULL;
CREATE INDEX ix_source_pages_last_seen_audit_id ON public.source_pages
    USING btree (last_seen_audit_id) WHERE last_seen_audit_id IS NOT NULL;
CREATE INDEX ix_source_pages_latest_snapshot_id ON public.source_pages
    USING btree (latest_snapshot_id) WHERE latest_snapshot_id IS NOT NULL;

-- 2. Background reads. The referral retention sweep pages one
--    workspace's expired events oldest first, and had no index leading with
--    the workspace.

CREATE INDEX ix_referral_events_retention ON public.referral_events
    USING btree (workspace_id, occurred_at, id);

-- 3. Queue claims. A claim reads claimable rows in (available_at, id)
--    order (queue/task-queue.ts claimStatement, next-due.ts). A
--    (status, available_at) index cannot return that order across the
--    claimable IN list, and it keeps every terminal row. Each lane's claim
--    index now holds claimable rows only, in claim order. The list is
--    config/queue.json `claimable`; the integration lane claims a subset of
--    it. The standalone available_at indexes only served the same reads.
--    Audit tasks had no lease index: it replaces the status-leading index the
--    lease recovery read.

DROP INDEX public.ix_agent_runs_available_at;
DROP INDEX public.ix_analytics_tasks_available_at;
DROP INDEX public.ix_analytics_tasks_claim;
DROP INDEX public.ix_audit_tasks_available_at;
DROP INDEX public.ix_audit_tasks_status_available_at;
DROP INDEX public.ix_brand_discovery_tasks_available_at;
DROP INDEX public.ix_brand_discovery_tasks_claim;
DROP INDEX public.ix_integration_sync_runs_available_at;
DROP INDEX public.ix_integration_sync_runs_claim;
DROP INDEX public.ix_site_crawl_tasks_available_at;
DROP INDEX public.ix_site_crawl_tasks_claim;

CREATE INDEX ix_agent_runs_claim ON public.agent_runs USING btree (available_at, id)
    WHERE status IN ('awaiting_provider_result', 'capacity_wait', 'queued', 'retry_wait',
        'submission_uncertain');
CREATE INDEX ix_analytics_tasks_claim ON public.analytics_tasks USING btree (available_at, id)
    WHERE status IN ('awaiting_provider_result', 'capacity_wait', 'queued', 'retry_wait',
        'submission_uncertain');
CREATE INDEX ix_audit_tasks_claim ON public.audit_tasks USING btree (available_at, id)
    WHERE status IN ('awaiting_provider_result', 'capacity_wait', 'queued', 'retry_wait',
        'submission_uncertain');
CREATE INDEX ix_brand_discovery_tasks_claim ON public.brand_discovery_tasks
    USING btree (available_at, id)
    WHERE status IN ('awaiting_provider_result', 'capacity_wait', 'queued', 'retry_wait',
        'submission_uncertain');
CREATE INDEX ix_integration_sync_runs_claim ON public.integration_sync_runs
    USING btree (available_at, id)
    WHERE status IN ('awaiting_provider_result', 'capacity_wait', 'queued', 'retry_wait',
        'submission_uncertain');
CREATE INDEX ix_site_crawl_tasks_claim ON public.site_crawl_tasks USING btree (available_at, id)
    WHERE status IN ('awaiting_provider_result', 'capacity_wait', 'queued', 'retry_wait',
        'submission_uncertain');
CREATE INDEX ix_audit_tasks_lease ON public.audit_tasks USING btree (status, lease_expires_at);

-- 4. Redundant indexes: each is a leading prefix of another index on
--    its table, so it only adds write cost.

DROP INDEX public.ix_audit_tasks_status;                      -- ix_audit_tasks_lease
DROP INDEX public.ix_agent_outputs_workspace_id;              -- uq_agent_outputs_ws_id
DROP INDEX public.ix_agent_output_revisions_workspace_id;     -- uq_agent_output_revisions_ws_id
DROP INDEX public.ix_commerce_categories_workspace_id;        -- uq_commerce_categories_scope_id
DROP INDEX public.ix_commerce_recommendation_observations_workspace_id;
                                                  -- uq_commerce_recommendation_observations_ws_id

-- 5. One provider attempt per task and number, like the sibling
--    attempt tables. The writer numbers attempts count + 1 under the audit and
--    task row locks; the key makes a second writer fail instead of duplicating.
--    It also leads with task_id, so the task_id index is redundant.

ALTER TABLE public.provider_attempts
    ADD CONSTRAINT uq_provider_attempt_slot UNIQUE (task_id, attempt_number);
DROP INDEX public.ix_provider_attempts_task_id;

-- 6. Status vocabularies, added NOT VALID and then validated as in
--    0014: a stored value outside its list fails this migration and nothing
--    changes. Each list is what its writer stores: Agent model attempt
--    outcomes (agent/model-calls.ts) and answer cost projections
--    (audits/costs.ts).

ALTER TABLE public.agent_model_attempts
    ADD CONSTRAINT ck_agent_model_attempts_outcome CHECK (outcome IN (
        'dispatched', 'completed', 'failed', 'recovered_unknown')) NOT VALID;
ALTER TABLE public.execution_cost_projections
    ADD CONSTRAINT ck_execution_cost_projections_status CHECK (projection_status IN (
        'complete', 'partial', 'unknown')) NOT VALID;

ALTER TABLE public.agent_model_attempts VALIDATE CONSTRAINT ck_agent_model_attempts_outcome;
ALTER TABLE public.execution_cost_projections
    VALIDATE CONSTRAINT ck_execution_cost_projections_status;
