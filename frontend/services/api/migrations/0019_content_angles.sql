-- Content angles. Forward-only and safe
-- on existing rows: five new tables, no change to existing data.
--
-- The `content_angle_refresh` analytics task groups the titles of competitor
-- and editorial pages cited in a project's recent answers into content angles
-- and matches each angle to at most one owned content page. Every row is
-- insert-only: a run is appended only when one of its input keys changed, and
-- each run keeps its source audit IDs, crawl ID, model and versions.
--
-- Tenancy follows 0007: each row names its workspace, binds to its project
-- through projects(workspace_id, id), and binds to its parent run, lineage or
-- angle through (workspace_id, id), so no row can point into another
-- workspace. References to topics, crawls and site URLs are SET NULL, as the
-- evidence outlives them. Status vocabularies are CHECKs (0014) and every
-- reference a project deletion follows is indexed (0018).

-- One angle computation. `outcome` is terminal at insert: `failed` (model
-- error, refused or rejected output) is kept for diagnosis and never selected
-- as a source.
CREATE TABLE public.content_angle_runs (
    id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    project_id uuid NOT NULL,
    trigger_kind text NOT NULL,
    trigger_id uuid NOT NULL,
    market_country text NOT NULL,
    market_language text NOT NULL,
    window_start timestamp with time zone NOT NULL,
    window_end timestamp with time zone NOT NULL,
    audit_ids uuid[] NOT NULL,
    crawl_id uuid,
    cluster_key text NOT NULL,
    match_key text NOT NULL,
    aggregate_key text NOT NULL,
    model_provider text,
    model text,
    methodology_version text NOT NULL,
    formula_version text NOT NULL,
    outcome text NOT NULL,
    outcome_reason text,
    limitations jsonb NOT NULL,
    usage jsonb,
    created_at timestamp with time zone NOT NULL,
    CONSTRAINT content_angle_runs_pkey PRIMARY KEY (id),
    CONSTRAINT uq_content_angle_runs_ws_id UNIQUE (workspace_id, id),
    CONSTRAINT ck_content_angle_runs_outcome CHECK (outcome IN ('failed', 'succeeded')),
    CONSTRAINT content_angle_runs_workspace_id_project_id_fkey FOREIGN KEY (workspace_id, project_id)
        REFERENCES public.projects(workspace_id, id) ON DELETE CASCADE,
    CONSTRAINT content_angle_runs_crawl_id_fkey FOREIGN KEY (crawl_id)
        REFERENCES public.site_crawls(id) ON DELETE SET NULL
);
CREATE INDEX ix_content_angle_runs_project_created
    ON public.content_angle_runs USING btree (workspace_id, project_id, created_at DESC);
CREATE INDEX ix_content_angle_runs_project_outcome_window
    ON public.content_angle_runs USING btree (workspace_id, project_id, outcome, window_end DESC);
CREATE INDEX ix_content_angle_runs_crawl_id
    ON public.content_angle_runs USING btree (crawl_id)
    WHERE crawl_id IS NOT NULL;

-- An angle's stable identity across reclustering. `planned_page_key` is set
-- once, the first time the lineage raises a new-page gap, and never rewritten.
CREATE TABLE public.content_angle_lineages (
    id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    project_id uuid NOT NULL,
    topic_id uuid,
    planned_page_key text,
    first_run_id uuid NOT NULL,
    created_at timestamp with time zone NOT NULL,
    CONSTRAINT content_angle_lineages_pkey PRIMARY KEY (id),
    CONSTRAINT uq_content_angle_lineages_ws_id UNIQUE (workspace_id, id),
    CONSTRAINT content_angle_lineages_workspace_id_project_id_fkey FOREIGN KEY (workspace_id, project_id)
        REFERENCES public.projects(workspace_id, id) ON DELETE CASCADE,
    CONSTRAINT content_angle_lineages_first_run_fkey FOREIGN KEY (workspace_id, first_run_id)
        REFERENCES public.content_angle_runs(workspace_id, id) ON DELETE CASCADE,
    CONSTRAINT content_angle_lineages_topic_id_fkey FOREIGN KEY (topic_id)
        REFERENCES public.topics(id) ON DELETE SET NULL
);
CREATE INDEX ix_content_angle_lineages_first_run_id
    ON public.content_angle_lineages USING btree (first_run_id);
CREATE INDEX ix_content_angle_lineages_topic_id
    ON public.content_angle_lineages USING btree (topic_id)
    WHERE topic_id IS NOT NULL;

-- One angle of a run, with its deterministic aggregates over the run's audits.
CREATE TABLE public.content_angles (
    id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    project_id uuid NOT NULL,
    run_id uuid NOT NULL,
    lineage_id uuid NOT NULL,
    topic_id uuid,
    label text NOT NULL,
    citation_count integer NOT NULL,
    domain_count integer NOT NULL,
    competitor_count integer NOT NULL,
    prompt_ids uuid[] NOT NULL,
    engines text[] NOT NULL,
    created_at timestamp with time zone NOT NULL,
    CONSTRAINT content_angles_pkey PRIMARY KEY (id),
    CONSTRAINT uq_content_angles_ws_id UNIQUE (workspace_id, id),
    CONSTRAINT content_angles_workspace_id_project_id_fkey FOREIGN KEY (workspace_id, project_id)
        REFERENCES public.projects(workspace_id, id) ON DELETE CASCADE,
    CONSTRAINT content_angles_run_fkey FOREIGN KEY (workspace_id, run_id)
        REFERENCES public.content_angle_runs(workspace_id, id) ON DELETE CASCADE,
    CONSTRAINT content_angles_lineage_fkey FOREIGN KEY (workspace_id, lineage_id)
        REFERENCES public.content_angle_lineages(workspace_id, id) ON DELETE CASCADE,
    CONSTRAINT content_angles_topic_id_fkey FOREIGN KEY (topic_id)
        REFERENCES public.topics(id) ON DELETE SET NULL
);
CREATE INDEX ix_content_angles_run_id ON public.content_angles USING btree (run_id);
CREATE INDEX ix_content_angles_lineage_id ON public.content_angles USING btree (lineage_id);
CREATE INDEX ix_content_angles_topic_id
    ON public.content_angles USING btree (topic_id)
    WHERE topic_id IS NOT NULL;

-- One cited URL in an angle, with the exact citations it aggregates.
CREATE TABLE public.content_angle_members (
    id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    project_id uuid NOT NULL,
    angle_id uuid NOT NULL,
    canonical_url text NOT NULL,
    url_hash text NOT NULL,
    title text NOT NULL,
    domain text NOT NULL,
    classification text NOT NULL,
    matched_competitor text,
    source_class text,
    citation_count integer NOT NULL,
    citation_ids uuid[] NOT NULL,
    created_at timestamp with time zone NOT NULL,
    CONSTRAINT content_angle_members_pkey PRIMARY KEY (id),
    CONSTRAINT content_angle_members_workspace_id_project_id_fkey FOREIGN KEY (workspace_id, project_id)
        REFERENCES public.projects(workspace_id, id) ON DELETE CASCADE,
    CONSTRAINT content_angle_members_angle_fkey FOREIGN KEY (workspace_id, angle_id)
        REFERENCES public.content_angles(workspace_id, id) ON DELETE CASCADE
);
CREATE INDEX ix_content_angle_members_angle_id
    ON public.content_angle_members USING btree (angle_id);

-- The owned content page an angle matched (`model_pick`), or none, and whether
-- that page was cited for the angle's prompts in the run's window.
CREATE TABLE public.content_angle_owned_matches (
    id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    project_id uuid NOT NULL,
    angle_id uuid NOT NULL,
    site_url_id uuid,
    method text NOT NULL,
    owned_cited boolean NOT NULL,
    owned_citation_ids uuid[] NOT NULL,
    created_at timestamp with time zone NOT NULL,
    CONSTRAINT content_angle_owned_matches_pkey PRIMARY KEY (id),
    CONSTRAINT ck_content_angle_owned_matches_method CHECK (method IN ('model_pick', 'none')),
    CONSTRAINT content_angle_owned_matches_workspace_id_project_id_fkey FOREIGN KEY (workspace_id, project_id)
        REFERENCES public.projects(workspace_id, id) ON DELETE CASCADE,
    CONSTRAINT content_angle_owned_matches_angle_fkey FOREIGN KEY (workspace_id, angle_id)
        REFERENCES public.content_angles(workspace_id, id) ON DELETE CASCADE,
    CONSTRAINT content_angle_owned_matches_site_url_id_fkey FOREIGN KEY (site_url_id)
        REFERENCES public.site_urls(id) ON DELETE SET NULL
);
-- At most one owned match per angle.
CREATE UNIQUE INDEX uq_content_angle_owned_matches_angle_id
    ON public.content_angle_owned_matches USING btree (angle_id);
CREATE INDEX ix_content_angle_owned_matches_site_url_id
    ON public.content_angle_owned_matches USING btree (site_url_id)
    WHERE site_url_id IS NOT NULL;
