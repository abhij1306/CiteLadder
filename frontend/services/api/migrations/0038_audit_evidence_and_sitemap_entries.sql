-- Answer, topic, theme and sitemap evidence for audits and Site Health.
-- Forward-only and applied in place: every NOT NULL column added to a table
-- that already holds rows gets a default for them, then the default is dropped.

ALTER TABLE public.actions
    ADD COLUMN goal character varying(32),
    ADD COLUMN goal_grouping character varying(32);

ALTER TABLE public.agent_messages
    ADD COLUMN attachments jsonb DEFAULT '[]'::jsonb NOT NULL,
    ADD COLUMN proposals jsonb DEFAULT '[]'::jsonb NOT NULL;

ALTER TABLE public.audit_answer_aggregates ADD COLUMN topic_id uuid;
ALTER TABLE public.audit_answer_aggregates DROP CONSTRAINT uq_audit_answer_aggregate;
ALTER TABLE ONLY public.audit_answer_aggregates
    ADD CONSTRAINT uq_audit_answer_aggregate UNIQUE NULLS NOT DISTINCT (audit_id, logical_engine, cohort, topic_id);

ALTER TABLE public.audit_source_aggregates ADD COLUMN topic_id uuid;

-- The topic the prompt had when the run froze it, so refiling or renaming a
-- topic never rewrites a past run. NULL: the prompt had no topic.
ALTER TABLE public.audit_prompt_snapshots
    ADD COLUMN topic_id uuid,
    ADD COLUMN topic_name character varying(255),
    ADD CONSTRAINT ck_audit_prompt_snapshot_topic CHECK (((topic_id IS NULL) = (topic_name IS NULL)));

ALTER TABLE public.observed_entity_candidates
    ADD COLUMN kind character varying(32) DEFAULT 'cited_domain' NOT NULL,
    ADD COLUMN name_key character varying(255),
    ADD COLUMN engine_total integer DEFAULT 0 NOT NULL,
    ADD COLUMN citation_count integer DEFAULT 0,
    ADD COLUMN decided_by_user_id uuid,
    ADD COLUMN decided_at timestamp with time zone;
ALTER TABLE public.observed_entity_candidates
    ALTER COLUMN kind DROP DEFAULT,
    ALTER COLUMN engine_total DROP DEFAULT,
    ALTER COLUMN citation_count DROP DEFAULT,
    ALTER COLUMN domain DROP NOT NULL;
ALTER TABLE public.observed_entity_candidates
    ADD CONSTRAINT ck_observed_candidate_kind CHECK (
        CASE kind
            WHEN 'cited_domain' THEN domain IS NOT NULL AND name_key IS NULL AND citation_count IS NOT NULL
            WHEN 'named_in_answers' THEN domain IS NULL AND name_key IS NOT NULL AND citation_count IS NULL
            ELSE false
        END
    );
ALTER TABLE ONLY public.observed_entity_candidates
    ADD CONSTRAINT uq_observed_candidate_name UNIQUE (audit_id, name_key);

-- Win rate: the tracked business the answer names first ('none': no tracked
-- business named). Answer formats: what a scraper answer showed besides text.
-- Existing analyses predate both, so they read 'none' and 'unavailable'.
ALTER TABLE public.response_analyses
    ADD COLUMN first_named_kind character varying(16) DEFAULT 'none' NOT NULL,
    ADD COLUMN first_named_name character varying(255),
    ADD COLUMN answer_format_state character varying(16) DEFAULT 'unavailable' NOT NULL,
    ADD COLUMN answer_formats text[],
    ADD COLUMN in_text_link_count integer;
ALTER TABLE public.response_analyses
    ALTER COLUMN first_named_kind DROP DEFAULT,
    ALTER COLUMN answer_format_state DROP DEFAULT;
ALTER TABLE public.response_analyses
    ADD CONSTRAINT ck_response_analyses_first_named CHECK (
        CASE first_named_kind
            WHEN 'none' THEN first_named_name IS NULL
            WHEN 'brand' THEN first_named_name IS NOT NULL
            WHEN 'competitor' THEN first_named_name IS NOT NULL
            ELSE false
        END
    ),
    ADD CONSTRAINT ck_response_analyses_answer_formats CHECK (
        CASE answer_format_state
            WHEN 'observed' THEN answer_formats IS NOT NULL AND in_text_link_count IS NOT NULL AND in_text_link_count >= 0
            WHEN 'unavailable' THEN answer_formats IS NULL AND in_text_link_count IS NULL
            WHEN 'not_applicable' THEN answer_formats IS NULL AND in_text_link_count IS NULL
            ELSE false
        END
    );

ALTER TABLE public.site_crawls ADD COLUMN live_counters jsonb;

ALTER TABLE ONLY public.observed_entity_candidates
    ADD CONSTRAINT observed_entity_candidates_decided_by_user_id_fkey FOREIGN KEY (decided_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;

CREATE TABLE public.action_urls (
    workspace_id uuid NOT NULL,
    project_id uuid NOT NULL,
    action_id uuid NOT NULL,
    site_url_id uuid NOT NULL
);

ALTER TABLE ONLY public.action_urls
    ADD CONSTRAINT action_urls_pkey PRIMARY KEY (action_id, site_url_id);

CREATE INDEX ix_action_urls_site_url ON public.action_urls USING btree (site_url_id, action_id);

CREATE INDEX ix_action_urls_workspace_project ON public.action_urls USING btree (workspace_id, project_id);

ALTER TABLE ONLY public.action_urls
    ADD CONSTRAINT fk_action_urls_action FOREIGN KEY (action_id) REFERENCES public.actions(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.action_urls
    ADD CONSTRAINT fk_action_urls_site_url FOREIGN KEY (site_url_id) REFERENCES public.site_urls(id) ON DELETE CASCADE;

-- The untracked business names each answer's perception returned, verified
-- against its passages: raw observations, append-only.
CREATE TABLE public.answer_untracked_names (
    id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    project_id uuid NOT NULL,
    audit_id uuid NOT NULL,
    perception_id uuid NOT NULL,
    analysis_id uuid NOT NULL,
    name character varying(255) NOT NULL,
    name_key character varying(255) NOT NULL,
    created_at timestamp with time zone NOT NULL
);

ALTER TABLE ONLY public.answer_untracked_names
    ADD CONSTRAINT answer_untracked_names_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.answer_untracked_names
    ADD CONSTRAINT uq_answer_untracked_name UNIQUE (perception_id, name_key);

CREATE INDEX ix_answer_untracked_names_audit_id ON public.answer_untracked_names USING btree (audit_id, name_key);

ALTER TABLE ONLY public.answer_untracked_names
    ADD CONSTRAINT answer_untracked_names_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.answer_untracked_names
    ADD CONSTRAINT answer_untracked_names_workspace_id_project_id_audit_id_fkey FOREIGN KEY (workspace_id, project_id, audit_id) REFERENCES public.audits(workspace_id, project_id, id) ON DELETE CASCADE;

ALTER TABLE ONLY public.answer_untracked_names
    ADD CONSTRAINT answer_untracked_names_perception_id_fkey FOREIGN KEY (perception_id) REFERENCES public.answer_perceptions(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.answer_untracked_names
    ADD CONSTRAINT answer_untracked_names_analysis_id_fkey FOREIGN KEY (analysis_id) REFERENCES public.response_analyses(id) ON DELETE CASCADE;

-- Fanout search queries: one row per finalized run, its answers' fanout
-- queries counted whole, with searches, share, the tracked brands each query
-- names and the share change against previous_audit_id (NULL: nothing to
-- compare).
CREATE TABLE public.audit_fanout_terms (
    id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    project_id uuid NOT NULL,
    audit_id uuid NOT NULL,
    previous_audit_id uuid,
    total_searches integer NOT NULL,
    unreported_engines text[] NOT NULL,
    terms jsonb NOT NULL,
    source_analysis_ids jsonb NOT NULL,
    analyzer_version character varying(32) NOT NULL,
    created_at timestamp with time zone NOT NULL,
    CONSTRAINT ck_audit_fanout_terms_total CHECK (total_searches >= 0)
);

ALTER TABLE ONLY public.audit_fanout_terms
    ADD CONSTRAINT audit_fanout_terms_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.audit_fanout_terms
    ADD CONSTRAINT uq_audit_fanout_terms_audit UNIQUE (audit_id);

CREATE INDEX ix_audit_fanout_terms_workspace_project ON public.audit_fanout_terms USING btree (workspace_id, project_id);

ALTER TABLE ONLY public.audit_fanout_terms
    ADD CONSTRAINT audit_fanout_terms_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.audit_fanout_terms
    ADD CONSTRAINT audit_fanout_terms_workspace_id_project_id_audit_id_fkey FOREIGN KEY (workspace_id, project_id, audit_id) REFERENCES public.audits(workspace_id, project_id, id) ON DELETE CASCADE;

-- Topic dimension: finalization groups a run's Sources facts by the topic each
-- prompt snapshot froze and writes one metric block per topic.
CREATE TABLE public.audit_topic_metrics (
    id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    project_id uuid NOT NULL,
    audit_id uuid NOT NULL,
    topic_id uuid NOT NULL,
    topic_name character varying(255) NOT NULL,
    visibility_score double precision NOT NULL,
    metrics jsonb NOT NULL,
    source_analysis_ids jsonb NOT NULL,
    analyzer_version character varying(32) NOT NULL,
    created_at timestamp with time zone NOT NULL
);

ALTER TABLE ONLY public.audit_topic_metrics
    ADD CONSTRAINT audit_topic_metrics_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.audit_topic_metrics
    ADD CONSTRAINT uq_audit_topic_metric UNIQUE (audit_id, topic_id);

CREATE INDEX ix_audit_topic_metrics_workspace_id ON public.audit_topic_metrics USING btree (workspace_id);

ALTER TABLE ONLY public.audit_topic_metrics
    ADD CONSTRAINT audit_topic_metrics_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.audit_topic_metrics
    ADD CONSTRAINT audit_topic_metrics_workspace_id_project_id_audit_id_fkey FOREIGN KEY (workspace_id, project_id, audit_id) REFERENCES public.audits(workspace_id, project_id, id) ON DELETE CASCADE;

-- Verdict overrides: a person's verdict on one claim, appended beside the
-- model's claim_verdicts row, which is never rewritten. Reads take the newest
-- override per verdict row.
CREATE TABLE public.claim_verdict_overrides (
    id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    claim_verdict_id uuid NOT NULL,
    from_verdict character varying(16) NOT NULL,
    to_verdict character varying(16) NOT NULL,
    note text,
    created_by_user_id uuid,
    created_at timestamp with time zone NOT NULL,
    CONSTRAINT ck_claim_verdict_override_from CHECK (from_verdict IN ('supported', 'contradicted', 'inconclusive', 'not_covered')),
    CONSTRAINT ck_claim_verdict_override_to CHECK (to_verdict IN ('supported', 'contradicted', 'inconclusive'))
);

ALTER TABLE ONLY public.claim_verdict_overrides
    ADD CONSTRAINT claim_verdict_overrides_pkey PRIMARY KEY (id);

CREATE INDEX ix_claim_verdict_overrides_ws_verdict_newest ON public.claim_verdict_overrides USING btree (workspace_id, claim_verdict_id, created_at DESC, id DESC);

ALTER TABLE ONLY public.claim_verdict_overrides
    ADD CONSTRAINT claim_verdict_overrides_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.claim_verdict_overrides
    ADD CONSTRAINT claim_verdict_overrides_claim_verdict_id_fkey FOREIGN KEY (claim_verdict_id) REFERENCES public.claim_verdicts(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.claim_verdict_overrides
    ADD CONSTRAINT claim_verdict_overrides_created_by_user_id_fkey FOREIGN KEY (created_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;

-- The buyer-facing themes perception classifies answers against. Aspects store
-- a theme's id, so a rename shows everywhere and a deleted theme's past
-- aspects read as the fallback.
CREATE TABLE public.project_themes (
    id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    project_id uuid NOT NULL,
    name character varying(80) NOT NULL,
    "position" integer NOT NULL,
    source character varying(16) NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    CONSTRAINT ck_project_themes_source CHECK ((source IN ('research', 'user')))
);

ALTER TABLE ONLY public.project_themes
    ADD CONSTRAINT project_themes_pkey PRIMARY KEY (id);

CREATE INDEX ix_project_themes_workspace_id_project_id ON public.project_themes USING btree (workspace_id, project_id);

ALTER TABLE ONLY public.project_themes
    ADD CONSTRAINT uq_project_themes_ws_project_id UNIQUE (workspace_id, project_id, id);

CREATE UNIQUE INDEX uq_project_theme_name ON public.project_themes USING btree (project_id, lower((name)::text));

ALTER TABLE ONLY public.project_themes
    ADD CONSTRAINT project_themes_workspace_id_project_id_fkey FOREIGN KEY (workspace_id, project_id) REFERENCES public.projects(workspace_id, id) ON DELETE CASCADE;

CREATE TABLE public.site_health_snapshot_analyses (
    workspace_id uuid NOT NULL,
    snapshot_id uuid NOT NULL,
    analysis_id uuid NOT NULL
);

ALTER TABLE ONLY public.site_health_snapshot_analyses
    ADD CONSTRAINT site_health_snapshot_analyses_pkey PRIMARY KEY (snapshot_id, analysis_id);

CREATE INDEX ix_site_health_snapshot_analyses_analysis ON public.site_health_snapshot_analyses USING btree (analysis_id);

ALTER TABLE ONLY public.site_health_snapshot_analyses
    ADD CONSTRAINT fk_site_health_snapshot_analyses_analysis FOREIGN KEY (analysis_id) REFERENCES public.site_page_analyses(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.site_health_snapshot_analyses
    ADD CONSTRAINT fk_site_health_snapshot_analyses_snapshot FOREIGN KEY (snapshot_id) REFERENCES public.site_health_snapshots(id) ON DELETE CASCADE;

CREATE TABLE public.site_sitemap_entries (
    id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    project_id uuid NOT NULL,
    crawl_id uuid NOT NULL,
    site_url_id uuid NOT NULL,
    listed_url character varying(2048) NOT NULL,
    lastmod character varying(64),
    created_at timestamp with time zone NOT NULL
);

ALTER TABLE ONLY public.site_sitemap_entries
    ADD CONSTRAINT site_sitemap_entries_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.site_sitemap_entries
    ADD CONSTRAINT uq_site_sitemap_entry UNIQUE (crawl_id, site_url_id);

CREATE INDEX ix_site_sitemap_entries_site_url_id ON public.site_sitemap_entries USING btree (site_url_id);

CREATE INDEX ix_site_sitemap_entries_workspace_project ON public.site_sitemap_entries USING btree (workspace_id, project_id);

ALTER TABLE ONLY public.site_sitemap_entries
    ADD CONSTRAINT fk_site_sitemap_entry_crawl FOREIGN KEY (crawl_id) REFERENCES public.site_crawls(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.site_sitemap_entries
    ADD CONSTRAINT fk_site_sitemap_entry_site_url_scoped FOREIGN KEY (workspace_id, project_id, site_url_id) REFERENCES public.site_urls(workspace_id, project_id, id) ON DELETE CASCADE;

-- A snapshot's analyses move from two uuid arrays to a join table.
INSERT INTO public.site_health_snapshot_analyses (workspace_id, snapshot_id, analysis_id)
SELECT DISTINCT s.workspace_id, s.id, a.analysis_id
FROM public.site_health_snapshots s
CROSS JOIN LATERAL unnest(s.source_analysis_ids) AS a(analysis_id)
WHERE EXISTS (SELECT 1 FROM public.site_page_analyses p WHERE p.id = a.analysis_id);

ALTER TABLE public.site_health_snapshots
    DROP COLUMN source_analysis_ids,
    DROP COLUMN source_evaluation_ids;
ALTER TABLE public.site_issue_catalogs DROP COLUMN sources;
