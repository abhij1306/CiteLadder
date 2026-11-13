-- Page documents (content optimization phase 2, PR 1). Forward-only and safe on
-- existing rows: one new table and three nullable columns.
--
-- An `optimize_page` chat commits a `page_fetch` analytics task instead of an
-- Agent run. The task fetches the live page once and appends one snapshot with
-- its outcome. A fetched page becomes the chat's `page` document: revision 1,
-- authored `fetch`, holds the main content as Markdown and the page's SEO
-- fields. Only then is the Agent run queued, so a failed fetch charges nothing.
--
-- Tenancy follows 0007 and the status vocabulary is a CHECK (0014). Every
-- reference a project deletion follows is indexed (0018).

-- One fetch of one page: the raw response (capped), its outcome and the
-- page-local Site Health evaluations of that response. Insert-only evidence.
-- `site_url_id` is null for a page outside the crawl; the chat and Action are
-- kept for traceability and outlive neither as owners.
CREATE TABLE public.page_snapshots (
    id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    project_id uuid NOT NULL,
    site_url_id uuid,
    chat_id uuid,
    action_id uuid,
    requested_url text NOT NULL,
    final_url text,
    fetched_at timestamp with time zone NOT NULL,
    http_status integer,
    outcome text NOT NULL,
    outcome_reason text,
    content_type text,
    charset text,
    body bytea,
    body_truncated boolean NOT NULL,
    extractor_version text NOT NULL,
    rules_version text,
    page_kind text,
    evaluations jsonb,
    created_at timestamp with time zone NOT NULL,
    CONSTRAINT page_snapshots_pkey PRIMARY KEY (id),
    CONSTRAINT uq_page_snapshots_ws_id UNIQUE (workspace_id, id),
    CONSTRAINT ck_page_snapshots_outcome CHECK (outcome IN (
        'fetched', 'blocked_robots', 'http_error', 'unsupported', 'failed'
    )),
    CONSTRAINT page_snapshots_workspace_id_project_id_fkey FOREIGN KEY (workspace_id, project_id)
        REFERENCES public.projects(workspace_id, id) ON DELETE CASCADE,
    CONSTRAINT page_snapshots_site_url_id_fkey FOREIGN KEY (site_url_id)
        REFERENCES public.site_urls(id) ON DELETE SET NULL,
    CONSTRAINT page_snapshots_chat_id_fkey FOREIGN KEY (chat_id)
        REFERENCES public.agent_chats(id) ON DELETE SET NULL,
    CONSTRAINT page_snapshots_action_id_fkey FOREIGN KEY (action_id)
        REFERENCES public.actions(id) ON DELETE SET NULL
);
CREATE INDEX ix_page_snapshots_project_id
    ON public.page_snapshots USING btree (workspace_id, project_id);
CREATE INDEX ix_page_snapshots_chat_fetched
    ON public.page_snapshots USING btree (chat_id, fetched_at DESC)
    WHERE chat_id IS NOT NULL;
CREATE INDEX ix_page_snapshots_site_url_id
    ON public.page_snapshots USING btree (site_url_id)
    WHERE site_url_id IS NOT NULL;
CREATE INDEX ix_page_snapshots_action_id
    ON public.page_snapshots USING btree (action_id)
    WHERE action_id IS NOT NULL;

-- A page revision's SEO block: `{title, meta_description, json_ld}`. Null for
-- every other kind of document. Revision 1 of a page document is authored
-- `fetch`; `author` is a varchar with no CHECK, so it needs no change here.
ALTER TABLE public.agent_output_revisions
    ADD COLUMN fields jsonb;

-- The snapshot a page document started from. Within the workspace only.
ALTER TABLE public.agent_outputs
    ADD COLUMN snapshot_id uuid;
ALTER TABLE public.agent_outputs
    ADD CONSTRAINT agent_outputs_snapshot_fkey FOREIGN KEY (workspace_id, snapshot_id)
        REFERENCES public.page_snapshots(workspace_id, id) ON DELETE CASCADE;
CREATE INDEX ix_agent_outputs_snapshot_id
    ON public.agent_outputs USING btree (snapshot_id)
    WHERE snapshot_id IS NOT NULL;
