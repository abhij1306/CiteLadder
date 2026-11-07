-- Drop columns left over from a hosted deployment model this self-hosted build
-- does not have: a reserved system workspace, platform-held provider
-- credentials, platform-funded audits and plan entitlement versions. Nothing
-- reads or writes them. Forward-only and applied in place.

DROP INDEX IF EXISTS public.uq_workspaces_single_system;
ALTER TABLE public.workspaces DROP COLUMN IF EXISTS is_system;

ALTER TABLE public.provider_connections DROP COLUMN IF EXISTS platform_credential_ref;

ALTER TABLE public.audits DROP COLUMN IF EXISTS funded_budget_period_start;

ALTER TABLE public.workspace_site_health_runtime
    DROP COLUMN IF EXISTS resolved_entitlement_lifecycle_version;
