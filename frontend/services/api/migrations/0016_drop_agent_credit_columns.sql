-- The Agent calls the operator's configured model gateway and nothing else:
-- there is no reservation, pricing revision or debit per call, and every run
-- uses the same gateway. Drop the columns that recorded those, forward-only;
-- existing databases upgrade in place.
ALTER TABLE public.agent_runs
    DROP COLUMN IF EXISTS funding_source;
ALTER TABLE public.agent_model_attempts
    DROP COLUMN IF EXISTS funding_source,
    DROP COLUMN IF EXISTS pricing_revision,
    DROP COLUMN IF EXISTS reservation_id,
    DROP COLUMN IF EXISTS reserved_credits,
    DROP COLUMN IF EXISTS debited_credits,
    DROP COLUMN IF EXISTS settlement_status;

-- A run refused because no Agent model is configured now records
-- `model_unavailable`, so earlier refusals read the same way.
UPDATE public.agent_runs
    SET error_code = 'model_unavailable'
    WHERE error_code = 'funding_unavailable';
