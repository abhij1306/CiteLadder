-- Scheduled crawls. Forward-only; a new
-- table, so no existing row changes.
--
-- One schedule per project, off until the person turns it on. A due row is
-- claimed under a lease (`lease_owner`, `lease_expires_at`) by the crawl
-- scheduler, which starts the crawl through ordinary crawl admission. An
-- occurrence skipped because a crawl is active or the fetch budget refused it
-- advances `next_run_at` and records `last_outcome`; any other refusal counts
-- in `failure_count`.

CREATE TABLE public.crawl_schedules (
    id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    project_id uuid NOT NULL,
    enabled boolean NOT NULL,
    cadence character varying(16) NOT NULL,
    next_run_at timestamp with time zone,
    last_run_at timestamp with time zone,
    last_outcome character varying(64),
    last_crawl_id uuid,
    failure_count integer NOT NULL,
    last_error character varying(255) NOT NULL,
    last_failure_at timestamp with time zone,
    lease_owner character varying(64),
    lease_expires_at timestamp with time zone,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    CONSTRAINT crawl_schedules_pkey PRIMARY KEY (id),
    CONSTRAINT crawl_schedules_cadence_check CHECK (cadence IN ('weekly', 'monthly')),
    CONSTRAINT crawl_schedules_enabled_next_run_check CHECK (NOT enabled OR next_run_at IS NOT NULL),
    CONSTRAINT crawl_schedules_workspace_id_project_id_key UNIQUE (workspace_id, project_id),
    CONSTRAINT crawl_schedules_workspace_id_fkey FOREIGN KEY (workspace_id)
        REFERENCES public.workspaces(id) ON DELETE CASCADE,
    CONSTRAINT crawl_schedules_workspace_id_project_id_fkey FOREIGN KEY (workspace_id, project_id)
        REFERENCES public.projects(workspace_id, id) ON DELETE CASCADE
);

CREATE INDEX ix_crawl_schedules_due ON public.crawl_schedules USING btree (next_run_at) WHERE enabled;
