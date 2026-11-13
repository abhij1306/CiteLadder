-- Answer-engine internal costs survive project deletion with their exact
-- source IDs, like Agent model and model call costs (DB-007). Forward-only and
-- safe on existing rows: the new columns are filled from each row's raw answer
-- before they become NOT NULL.
--
-- A cost row stops referencing its audit, task and raw answer, which a project
-- deletion removes, keeps its workspace key, and carries the engine, provider
-- and model it was priced for, taken from its raw answer.

ALTER TABLE public.execution_cost_projections
    ADD COLUMN logical_engine character varying(32),
    ADD COLUMN transport_provider character varying(32),
    ADD COLUMN transport_model character varying(255);
UPDATE public.execution_cost_projections AS e
    SET logical_engine = r.logical_engine,
        transport_provider = r.transport_provider,
        transport_model = r.transport_model
    FROM public.raw_response_artifacts AS r WHERE r.id = e.raw_response_artifact_id;
ALTER TABLE public.execution_cost_projections
    ALTER COLUMN logical_engine SET NOT NULL,
    ALTER COLUMN transport_provider SET NOT NULL,
    ALTER COLUMN transport_model SET NOT NULL,
    DROP CONSTRAINT execution_cost_projections_workspace_id_audit_id_fkey,
    DROP CONSTRAINT execution_cost_projections_workspace_id_task_id_fkey,
    DROP CONSTRAINT execution_cost_projections_workspace_id_artifact_id_fkey,
    ADD CONSTRAINT execution_cost_projections_workspace_id_fkey FOREIGN KEY (workspace_id)
        REFERENCES public.workspaces(id) ON DELETE CASCADE;
CREATE INDEX ix_execution_cost_projections_workspace_id ON public.execution_cost_projections
    USING btree (workspace_id);
