-- Brings a database migrated by CiteLadder v0.1.0 to the current 0001 baseline.
-- v0.1.0's baseline still carried the hosted service's billing, credit-grant,
-- invitation and MCP OAuth tables; the self-hosted build never wrote them, so
-- they are dropped with no data loss. The migration runner applies this once,
-- only to a database whose recorded 0001 checksum is v0.1.0's, then records
-- the current checksum.

DROP TABLE IF EXISTS
    public.introductory_claims,
    public.introductory_operator_codes,
    public.grant_revocations,
    public.consumable_ledger,
    public.account_grants,
    public.billing_invoices,
    public.billing_payments,
    public.billing_subscriptions,
    public.billing_invoice_counters,
    public.billing_catalog_revisions,
    public.billing_webhook_events,
    public.pending_activations,
    public.idempotency_records,
    public.enterprise_agreement_references,
    public.account_policy_acceptances,
    public.policy_acceptances,
    public.auth_challenges,
    public.mcp_authorization_codes,
    public.mcp_authorization_requests,
    public.workspace_invitations
    CASCADE;

-- Live tables lose the columns that pointed at billing accounts. Dropping a
-- column drops the constraints that name it, so the two that still mean
-- something without it are recreated.
ALTER TABLE public.audits DROP COLUMN IF EXISTS funding_account_id;

ALTER TABLE public.platform_calls DROP COLUMN IF EXISTS billing_account_id;
ALTER TABLE public.platform_calls DROP CONSTRAINT IF EXISTS ck_platform_calls_hold;
ALTER TABLE public.platform_calls ADD CONSTRAINT ck_platform_calls_hold CHECK (((((charge)::text = 'credits'::text) AND (reserved_credits > 0)) OR (((charge)::text <> 'credits'::text) AND (reservation_id IS NULL) AND (reserved_credits = 0))));

ALTER TABLE public.provider_capacity_buckets DROP COLUMN IF EXISTS billing_account_id;
ALTER TABLE public.provider_capacity_buckets DROP CONSTRAINT IF EXISTS uq_provider_capacity_bucket_pool;
ALTER TABLE ONLY public.provider_capacity_buckets
    ADD CONSTRAINT uq_provider_capacity_bucket_pool UNIQUE NULLS NOT DISTINCT (pool_kind, transport_provider, account_pool_identity, connection_id);

DROP TABLE IF EXISTS public.billing_accounts CASCADE;
