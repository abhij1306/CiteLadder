-- Issue state and trend. Forward-only; two new tables, so no existing row changes. Greenfield:
-- no backfill, the first landing audit after this writes them.
--
-- site_issue_states holds one row per project, page and rule: the issue's
-- lifecycle across audits. Each audit that lands moves the states of the pages
-- it audited, in its own transaction (`site-health/issue-states.ts`). The
-- source columns name the exact crawl and the issue, evaluation, analysis or
-- fetch attempt that decided the state; issues, evaluations and attempts stay
-- append-only. `last_audit_at` is the deciding audit's time, so an older
-- audit landing late never overwrites a newer one.
--
-- site_issue_trend holds the project's open issue count, one row per UTC day,
-- rewritten by each landing that day. Both are mutable projections.

CREATE TABLE public.site_issue_states (
    id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    project_id uuid NOT NULL,
    site_url_id uuid NOT NULL,
    rule_id character varying(64) NOT NULL,
    state character varying(24) NOT NULL,
    first_seen_at timestamp with time zone NOT NULL,
    last_seen_at timestamp with time zone NOT NULL,
    resolved_at timestamp with time zone,
    marked_fixed_at timestamp with time zone,
    last_audit_at timestamp with time zone NOT NULL,
    source_crawl_id uuid NOT NULL,
    source_analysis_id uuid,
    source_attempt_id uuid,
    source_evaluation_id uuid,
    source_issue_id uuid,
    evidence jsonb,
    rule_version character varying(32) NOT NULL,
    analyzer_version character varying(32) NOT NULL,
    policy_version character varying(32) NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    CONSTRAINT site_issue_states_pkey PRIMARY KEY (id),
    CONSTRAINT ck_site_issue_states_state CHECK (state IN (
        'open', 'marked_fixed', 'resolved', 'regressed', 'page_unavailable', 'no_longer_tracked')),
    CONSTRAINT ck_site_issue_states_resolved CHECK ((state = 'resolved') = (resolved_at IS NOT NULL)),
    CONSTRAINT uq_site_issue_state UNIQUE (workspace_id, project_id, site_url_id, rule_id),
    CONSTRAINT site_issue_states_workspace_id_project_id_fkey FOREIGN KEY (workspace_id, project_id)
        REFERENCES public.projects(workspace_id, id) ON DELETE CASCADE,
    -- The page and the deciding crawl belong to the same project and workspace.
    CONSTRAINT fk_site_issue_state_site_url_scoped FOREIGN KEY (workspace_id, project_id, site_url_id)
        REFERENCES public.site_urls(workspace_id, project_id, id) ON DELETE CASCADE,
    CONSTRAINT fk_site_issue_state_crawl_scoped FOREIGN KEY (workspace_id, project_id, source_crawl_id)
        REFERENCES public.site_crawls(workspace_id, project_id, id) ON DELETE CASCADE,
    CONSTRAINT site_issue_states_source_analysis_id_fkey FOREIGN KEY (source_analysis_id)
        REFERENCES public.site_page_analyses(id) ON DELETE CASCADE,
    CONSTRAINT site_issue_states_source_attempt_id_fkey FOREIGN KEY (source_attempt_id)
        REFERENCES public.site_fetch_attempts(id) ON DELETE CASCADE,
    CONSTRAINT site_issue_states_source_evaluation_id_fkey FOREIGN KEY (source_evaluation_id)
        REFERENCES public.site_rule_evaluations(id) ON DELETE CASCADE,
    CONSTRAINT site_issue_states_source_issue_id_fkey FOREIGN KEY (source_issue_id)
        REFERENCES public.site_issues(id) ON DELETE CASCADE
);

CREATE INDEX ix_site_issue_states_project_state
    ON public.site_issue_states USING btree (workspace_id, project_id, state);
CREATE INDEX ix_site_issue_states_source_crawl_id
    ON public.site_issue_states USING btree (source_crawl_id);
CREATE INDEX ix_site_issue_states_source_analysis_id
    ON public.site_issue_states USING btree (source_analysis_id);
CREATE INDEX ix_site_issue_states_source_attempt_id
    ON public.site_issue_states USING btree (source_attempt_id);
CREATE INDEX ix_site_issue_states_source_evaluation_id
    ON public.site_issue_states USING btree (source_evaluation_id);
CREATE INDEX ix_site_issue_states_source_issue_id
    ON public.site_issue_states USING btree (source_issue_id);
CREATE INDEX ix_site_issue_states_site_url_id
    ON public.site_issue_states USING btree (site_url_id);

CREATE TABLE public.site_issue_trend (
    id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    project_id uuid NOT NULL,
    day date NOT NULL,
    open_count integer NOT NULL,
    source_crawl_id uuid NOT NULL,
    policy_version character varying(32) NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    CONSTRAINT site_issue_trend_pkey PRIMARY KEY (id),
    CONSTRAINT ck_site_issue_trend_open_count CHECK (open_count >= 0),
    CONSTRAINT uq_site_issue_trend_day UNIQUE (workspace_id, project_id, day),
    CONSTRAINT site_issue_trend_workspace_id_project_id_fkey FOREIGN KEY (workspace_id, project_id)
        REFERENCES public.projects(workspace_id, id) ON DELETE CASCADE,
    CONSTRAINT fk_site_issue_trend_crawl_scoped FOREIGN KEY (workspace_id, project_id, source_crawl_id)
        REFERENCES public.site_crawls(workspace_id, project_id, id) ON DELETE CASCADE
);

CREATE INDEX ix_site_issue_trend_source_crawl_id
    ON public.site_issue_trend USING btree (source_crawl_id);
