-- Model-call usage records and Keyword Research runs without hosted billing.
-- Forward-only and applied in place.
--
-- The model-call log records what each provider call cost the operator
-- (tokens, cost_microusd, status, error). Nothing is charged, reserved or
-- settled against a balance, so the charge, credit, reservation and pricing
-- revision columns go, with their checks and the unsettled-hold index. The
-- table is renamed `model_calls`: calls are paid for by the operator's own
-- provider keys, and every recorded call is written already settled or failed.
--
-- Keyword Research runs use the workspace's own DataForSEO connection only,
-- so the credit estimate, the charged credits and the link to a paid model
-- call are dropped and `credential_source` is constrained to 'byok'.

ALTER TABLE public.search_intelligence_runs
    DROP CONSTRAINT IF EXISTS ck_si_runs_credential_source,
    DROP CONSTRAINT IF EXISTS search_intelligence_runs_platform_call_id_fkey;
DROP INDEX IF EXISTS public.ix_search_intelligence_runs_platform_call_id;
ALTER TABLE public.search_intelligence_runs
    DROP COLUMN IF EXISTS estimated_credits,
    DROP COLUMN IF EXISTS charged_credits,
    DROP COLUMN IF EXISTS platform_call_id;
ALTER TABLE public.search_intelligence_runs
    ADD CONSTRAINT ck_si_runs_credential_source CHECK (credential_source = 'byok') NOT VALID;
ALTER TABLE public.search_intelligence_runs VALIDATE CONSTRAINT ck_si_runs_credential_source;

DROP INDEX IF EXISTS public.ix_platform_calls_unsettled;
ALTER TABLE public.platform_calls
    DROP CONSTRAINT IF EXISTS ck_platform_calls_charge,
    DROP CONSTRAINT IF EXISTS ck_platform_calls_credits,
    DROP CONSTRAINT IF EXISTS ck_platform_calls_hold,
    DROP CONSTRAINT IF EXISTS ck_platform_calls_status;
ALTER TABLE public.platform_calls
    DROP COLUMN IF EXISTS charge,
    DROP COLUMN IF EXISTS pricing_revision,
    DROP COLUMN IF EXISTS reservation_id,
    DROP COLUMN IF EXISTS reserved_credits,
    DROP COLUMN IF EXISTS credits,
    DROP COLUMN IF EXISTS owner_settled;

-- A call stayed 'reserved' only while a credit hold was open, and none is
-- written now; any such row is kept, closed as failed.
UPDATE public.platform_calls
    SET status = 'failed', settled_at = created_at, error_code = 'unsettled'
    WHERE status = 'reserved';

ALTER TABLE public.platform_calls RENAME TO model_calls;
ALTER TABLE public.model_calls RENAME CONSTRAINT platform_calls_pkey TO model_calls_pkey;
ALTER TABLE public.model_calls
    RENAME CONSTRAINT platform_calls_workspace_id_fkey TO model_calls_workspace_id_fkey;
ALTER TABLE public.model_calls
    RENAME CONSTRAINT ck_platform_calls_settled TO ck_model_calls_settled;
ALTER INDEX public.ix_platform_calls_workspace_created RENAME TO ix_model_calls_workspace_created;
ALTER TABLE public.model_calls
    ADD CONSTRAINT ck_model_calls_status CHECK (status IN ('settled', 'failed'));
