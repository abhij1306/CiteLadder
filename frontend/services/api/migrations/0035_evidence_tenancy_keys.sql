-- Tenancy in the schema for the project-owned evidence tables that had no
-- workspace_id (DB-001, invariant 3): each row names its workspace, and every
-- key to a workspace-owned parent names both, so PostgreSQL refuses a row
-- whose parent belongs to another workspace.
--
-- Safe on a database that has rows: each new column is filled from its owning
-- parent before it becomes NOT NULL and before the composite keys are added.
--
-- 1. Parents gain the (workspace_id, id) key a composite reference targets.

ALTER TABLE public.audits ADD CONSTRAINT uq_audits_ws_id UNIQUE (workspace_id, id);
ALTER TABLE public.audit_tasks ADD CONSTRAINT uq_audit_tasks_ws_id UNIQUE (workspace_id, id);
ALTER TABLE public.site_crawls ADD CONSTRAINT uq_site_crawls_ws_id UNIQUE (workspace_id, id);
ALTER TABLE public.brands ADD CONSTRAINT uq_brands_ws_id UNIQUE (workspace_id, id);
ALTER TABLE public.prompts ADD CONSTRAINT uq_prompts_ws_id UNIQUE (workspace_id, id);
ALTER TABLE public.citations ADD CONSTRAINT uq_citations_ws_id UNIQUE (workspace_id, id);
ALTER TABLE public.commerce_recommendation_observations
    ADD CONSTRAINT uq_commerce_recommendation_observations_ws_id UNIQUE (workspace_id, id);

-- 2. Evidence keyed to an audit takes the audit's workspace. An engine
--    snapshot's connection keeps its single-column key.

ALTER TABLE public.raw_response_artifacts ADD COLUMN workspace_id uuid;
UPDATE public.raw_response_artifacts AS t SET workspace_id = a.workspace_id
    FROM public.audits AS a WHERE a.id = t.audit_id;
ALTER TABLE public.raw_response_artifacts
    ALTER COLUMN workspace_id SET NOT NULL,
    DROP CONSTRAINT raw_response_artifacts_audit_id_fkey,
    DROP CONSTRAINT raw_response_artifacts_task_id_fkey,
    ADD CONSTRAINT raw_response_artifacts_workspace_id_audit_id_fkey FOREIGN KEY (workspace_id, audit_id) REFERENCES public.audits(workspace_id, id) ON DELETE CASCADE,
    ADD CONSTRAINT raw_response_artifacts_workspace_id_task_id_fkey FOREIGN KEY (workspace_id, task_id) REFERENCES public.audit_tasks(workspace_id, id) ON DELETE CASCADE,
    ADD CONSTRAINT uq_raw_response_artifacts_ws_id UNIQUE (workspace_id, id);

ALTER TABLE public.provider_attempts ADD COLUMN workspace_id uuid;
UPDATE public.provider_attempts AS t SET workspace_id = a.workspace_id
    FROM public.audits AS a WHERE a.id = t.audit_id;
ALTER TABLE public.provider_attempts
    ALTER COLUMN workspace_id SET NOT NULL,
    DROP CONSTRAINT provider_attempts_audit_id_fkey,
    DROP CONSTRAINT provider_attempts_task_id_fkey,
    DROP CONSTRAINT provider_attempts_artifact_id_fkey,
    ADD CONSTRAINT provider_attempts_workspace_id_audit_id_fkey FOREIGN KEY (workspace_id, audit_id) REFERENCES public.audits(workspace_id, id) ON DELETE CASCADE,
    ADD CONSTRAINT provider_attempts_workspace_id_task_id_fkey FOREIGN KEY (workspace_id, task_id) REFERENCES public.audit_tasks(workspace_id, id) ON DELETE CASCADE,
    ADD CONSTRAINT provider_attempts_workspace_id_artifact_id_fkey FOREIGN KEY (workspace_id, artifact_id) REFERENCES public.raw_response_artifacts(workspace_id, id) ON DELETE SET NULL (artifact_id);

ALTER TABLE public.audit_events ADD COLUMN workspace_id uuid;
UPDATE public.audit_events AS t SET workspace_id = a.workspace_id
    FROM public.audits AS a WHERE a.id = t.audit_id;
ALTER TABLE public.audit_events
    ALTER COLUMN workspace_id SET NOT NULL,
    DROP CONSTRAINT audit_events_audit_id_fkey,
    ADD CONSTRAINT audit_events_workspace_id_audit_id_fkey FOREIGN KEY (workspace_id, audit_id) REFERENCES public.audits(workspace_id, id) ON DELETE CASCADE;

ALTER TABLE public.audit_prompt_snapshots ADD COLUMN workspace_id uuid;
UPDATE public.audit_prompt_snapshots AS t SET workspace_id = a.workspace_id
    FROM public.audits AS a WHERE a.id = t.audit_id;
ALTER TABLE public.audit_prompt_snapshots
    ALTER COLUMN workspace_id SET NOT NULL,
    DROP CONSTRAINT audit_prompt_snapshots_audit_id_fkey,
    DROP CONSTRAINT audit_prompt_snapshots_prompt_id_fkey,
    ADD CONSTRAINT audit_prompt_snapshots_workspace_id_audit_id_fkey FOREIGN KEY (workspace_id, audit_id) REFERENCES public.audits(workspace_id, id) ON DELETE CASCADE,
    ADD CONSTRAINT audit_prompt_snapshots_workspace_id_prompt_id_fkey FOREIGN KEY (workspace_id, prompt_id) REFERENCES public.prompts(workspace_id, id) ON DELETE SET NULL (prompt_id);

ALTER TABLE public.audit_engine_snapshots ADD COLUMN workspace_id uuid;
UPDATE public.audit_engine_snapshots AS t SET workspace_id = a.workspace_id
    FROM public.audits AS a WHERE a.id = t.audit_id;
ALTER TABLE public.audit_engine_snapshots
    ALTER COLUMN workspace_id SET NOT NULL,
    DROP CONSTRAINT audit_engine_snapshots_audit_id_fkey,
    ADD CONSTRAINT audit_engine_snapshots_workspace_id_audit_id_fkey FOREIGN KEY (workspace_id, audit_id) REFERENCES public.audits(workspace_id, id) ON DELETE CASCADE;

ALTER TABLE public.execution_cost_projections ADD COLUMN workspace_id uuid;
UPDATE public.execution_cost_projections AS t SET workspace_id = a.workspace_id
    FROM public.audits AS a WHERE a.id = t.audit_id;
ALTER TABLE public.execution_cost_projections
    ALTER COLUMN workspace_id SET NOT NULL,
    DROP CONSTRAINT execution_cost_projections_audit_id_fkey,
    DROP CONSTRAINT execution_cost_projections_task_id_fkey,
    DROP CONSTRAINT execution_cost_projections_raw_response_artifact_id_fkey,
    ADD CONSTRAINT execution_cost_projections_workspace_id_audit_id_fkey FOREIGN KEY (workspace_id, audit_id) REFERENCES public.audits(workspace_id, id) ON DELETE CASCADE,
    ADD CONSTRAINT execution_cost_projections_workspace_id_task_id_fkey FOREIGN KEY (workspace_id, task_id) REFERENCES public.audit_tasks(workspace_id, id) ON DELETE CASCADE,
    ADD CONSTRAINT execution_cost_projections_workspace_id_artifact_id_fkey FOREIGN KEY (workspace_id, raw_response_artifact_id) REFERENCES public.raw_response_artifacts(workspace_id, id) ON DELETE CASCADE;

-- 3. Crawl events take the crawl's workspace, brand aliases the brand's.

ALTER TABLE public.site_crawl_events ADD COLUMN workspace_id uuid;
UPDATE public.site_crawl_events AS t SET workspace_id = c.workspace_id
    FROM public.site_crawls AS c WHERE c.id = t.crawl_id;
ALTER TABLE public.site_crawl_events
    ALTER COLUMN workspace_id SET NOT NULL,
    DROP CONSTRAINT site_crawl_events_crawl_id_fkey,
    ADD CONSTRAINT site_crawl_events_workspace_id_crawl_id_fkey FOREIGN KEY (workspace_id, crawl_id) REFERENCES public.site_crawls(workspace_id, id) ON DELETE CASCADE;

ALTER TABLE public.brand_aliases ADD COLUMN workspace_id uuid;
UPDATE public.brand_aliases AS t SET workspace_id = b.workspace_id
    FROM public.brands AS b WHERE b.id = t.brand_id;
ALTER TABLE public.brand_aliases
    ALTER COLUMN workspace_id SET NOT NULL,
    DROP CONSTRAINT brand_aliases_brand_id_fkey,
    ADD CONSTRAINT brand_aliases_workspace_id_brand_id_fkey FOREIGN KEY (workspace_id, brand_id) REFERENCES public.brands(workspace_id, id) ON DELETE CASCADE;

-- 4. A shelf observation's citation link takes the observation's workspace,
--    and the citation it names must share it.

ALTER TABLE public.commerce_observation_citations ADD COLUMN workspace_id uuid;
UPDATE public.commerce_observation_citations AS t SET workspace_id = o.workspace_id
    FROM public.commerce_recommendation_observations AS o WHERE o.id = t.observation_id;
ALTER TABLE public.commerce_observation_citations
    ALTER COLUMN workspace_id SET NOT NULL,
    DROP CONSTRAINT commerce_observation_citations_observation_id_fkey,
    DROP CONSTRAINT commerce_observation_citations_citation_id_fkey,
    ADD CONSTRAINT commerce_observation_citations_workspace_id_observation_id_fkey FOREIGN KEY (workspace_id, observation_id) REFERENCES public.commerce_recommendation_observations(workspace_id, id) ON DELETE CASCADE,
    ADD CONSTRAINT commerce_observation_citations_workspace_id_citation_id_fkey FOREIGN KEY (workspace_id, citation_id) REFERENCES public.citations(workspace_id, id) ON DELETE CASCADE;
