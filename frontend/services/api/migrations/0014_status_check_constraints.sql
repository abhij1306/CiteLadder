-- Status vocabularies enforced by PostgreSQL (state-machine fixes DB1).
-- Forward-only and applied in place: each CHECK is added NOT VALID and then
-- validated, so a stored value outside its list fails this migration's
-- transaction and nothing changes. There is no backfill.
--
-- Each list is its owner's declared vocabulary: the shared queue statuses
-- (config/queue.json) for every lane table, plus `pending_reservation` for
-- audit tasks; the audit transitions (config/audits.json); the crawl
-- sub-states (packages/contracts site-health/crawl.ts); the Keyword Research
-- run statuses (contracts search-intelligence.ts) and the call and dataset
-- states written by search-intelligence/acquisition-state.ts; the
-- integration grant statuses; the Action statuses
-- (config/actions.ts); the prompt statuses; and the prompt candidate
-- dispositions (config/prompt-library.json `prompts.candidate`).
--
-- `site_urls.discovery_status` was written on every sighting and read by
-- nothing; its writers are gone and the column is dropped.

ALTER TABLE public.agent_runs
    ADD CONSTRAINT ck_agent_runs_status CHECK (status IN (
        'awaiting_provider_result', 'cancelled', 'capacity_wait', 'failed', 'leased',
        'queued', 'retry_wait', 'running', 'submission_uncertain', 'succeeded')) NOT VALID;
ALTER TABLE public.analytics_tasks
    ADD CONSTRAINT ck_analytics_tasks_status CHECK (status IN (
        'awaiting_provider_result', 'cancelled', 'capacity_wait', 'failed', 'leased',
        'queued', 'retry_wait', 'running', 'submission_uncertain', 'succeeded')) NOT VALID;
ALTER TABLE public.audit_tasks
    ADD CONSTRAINT ck_audit_tasks_status CHECK (status IN (
        'awaiting_provider_result', 'cancelled', 'capacity_wait', 'failed', 'leased',
        'pending_reservation', 'queued', 'retry_wait', 'running', 'submission_uncertain',
        'succeeded')) NOT VALID;
ALTER TABLE public.brand_discovery_tasks
    ADD CONSTRAINT ck_brand_discovery_tasks_status CHECK (status IN (
        'awaiting_provider_result', 'cancelled', 'capacity_wait', 'failed', 'leased',
        'queued', 'retry_wait', 'running', 'submission_uncertain', 'succeeded')) NOT VALID;
ALTER TABLE public.integration_sync_runs
    ADD CONSTRAINT ck_integration_sync_runs_status CHECK (status IN (
        'awaiting_provider_result', 'cancelled', 'capacity_wait', 'failed', 'leased',
        'queued', 'retry_wait', 'running', 'submission_uncertain', 'succeeded')) NOT VALID;
ALTER TABLE public.site_crawl_tasks
    ADD CONSTRAINT ck_site_crawl_tasks_status CHECK (status IN (
        'awaiting_provider_result', 'cancelled', 'capacity_wait', 'failed', 'leased',
        'queued', 'retry_wait', 'running', 'submission_uncertain', 'succeeded')) NOT VALID;

ALTER TABLE public.audits
    ADD CONSTRAINT ck_audits_status CHECK (status IN (
        'analyzing', 'cancelled', 'completed', 'draft', 'failed', 'partially_completed',
        'queued', 'reporting', 'running', 'validating')) NOT VALID;

ALTER TABLE public.site_crawls
    ADD CONSTRAINT ck_site_crawls_status CHECK (status IN (
        'cancelled', 'completed', 'failed', 'partially_completed', 'queued',
        'running')) NOT VALID,
    ADD CONSTRAINT ck_site_crawls_discovery_status CHECK (discovery_status IN (
        'cancelled', 'completed', 'failed', 'pending', 'running', 'sample_completed',
        'stopped')) NOT VALID,
    ADD CONSTRAINT ck_site_crawls_analysis_status CHECK (analysis_status IN (
        'cancelled', 'completed', 'failed', 'partially_completed', 'pending', 'running',
        'stopped')) NOT VALID;

ALTER TABLE public.search_intelligence_runs
    ADD CONSTRAINT ck_si_runs_status CHECK (status IN (
        'cancelled', 'failed', 'partial', 'queued', 'reviewed', 'running', 'succeeded',
        'uncertain')) NOT VALID;
ALTER TABLE public.search_intelligence_calls
    ADD CONSTRAINT ck_si_calls_status CHECK (status IN (
        'dispatched', 'failed', 'intent', 'succeeded', 'uncertain')) NOT VALID;
ALTER TABLE public.search_intelligence_datasets
    ADD CONSTRAINT ck_si_datasets_status CHECK (status IN (
        'collecting', 'failed', 'published')) NOT VALID;

ALTER TABLE public.integration_oauth_grants
    ADD CONSTRAINT ck_integration_oauth_grant_status CHECK (status IN (
        'connected', 'error', 'needs_reauth', 'pending_revocation', 'revoked')) NOT VALID;

ALTER TABLE public.actions
    ADD CONSTRAINT ck_actions_status CHECK (status IN (
        'dismissed', 'done', 'implemented', 'in_progress', 'measuring', 'open')) NOT VALID;
ALTER TABLE public.prompts
    ADD CONSTRAINT ck_prompts_status CHECK (status IN ('active', 'archived')) NOT VALID;
ALTER TABLE public.prompt_candidates
    ADD CONSTRAINT ck_prompt_candidates_disposition CHECK (disposition IN (
        'accepted', 'gate_rejected', 'pending', 'rejected')) NOT VALID;

ALTER TABLE public.agent_runs VALIDATE CONSTRAINT ck_agent_runs_status;
ALTER TABLE public.analytics_tasks VALIDATE CONSTRAINT ck_analytics_tasks_status;
ALTER TABLE public.audit_tasks VALIDATE CONSTRAINT ck_audit_tasks_status;
ALTER TABLE public.brand_discovery_tasks VALIDATE CONSTRAINT ck_brand_discovery_tasks_status;
ALTER TABLE public.integration_sync_runs VALIDATE CONSTRAINT ck_integration_sync_runs_status;
ALTER TABLE public.site_crawl_tasks VALIDATE CONSTRAINT ck_site_crawl_tasks_status;
ALTER TABLE public.audits VALIDATE CONSTRAINT ck_audits_status;
ALTER TABLE public.site_crawls VALIDATE CONSTRAINT ck_site_crawls_status;
ALTER TABLE public.site_crawls VALIDATE CONSTRAINT ck_site_crawls_discovery_status;
ALTER TABLE public.site_crawls VALIDATE CONSTRAINT ck_site_crawls_analysis_status;
ALTER TABLE public.search_intelligence_runs VALIDATE CONSTRAINT ck_si_runs_status;
ALTER TABLE public.search_intelligence_calls VALIDATE CONSTRAINT ck_si_calls_status;
ALTER TABLE public.search_intelligence_datasets VALIDATE CONSTRAINT ck_si_datasets_status;
ALTER TABLE public.integration_oauth_grants VALIDATE CONSTRAINT ck_integration_oauth_grant_status;
ALTER TABLE public.actions VALIDATE CONSTRAINT ck_actions_status;
ALTER TABLE public.prompts VALIDATE CONSTRAINT ck_prompts_status;
ALTER TABLE public.prompt_candidates VALIDATE CONSTRAINT ck_prompt_candidates_disposition;

ALTER TABLE public.site_urls DROP COLUMN discovery_status;
