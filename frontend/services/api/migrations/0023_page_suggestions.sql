-- Page suggestions. Forward-only and safe
-- on existing rows: two new tables and two unique keys on columns that are
-- already primary keys.
--
-- A suggestion is one finding on a page document (content rules engine,
-- "Findings and anchoring"): a span of the Markdown body, an SEO field or the
-- page as a whole, made against one revision. The Agent writes them with the
-- `suggest_edits` built-in, committed with its reply; the page fetch writes the
-- page-local Site Health findings that have a field fix. Suggestions are
-- insert-only. What happened to one since is its append-only events: `open`,
-- `applied`, `dismissed`, `reverted` (back to open) and `stale`. An event that
-- leaves the suggestion's text in a revision names that revision and the
-- span's UTF-16 offsets there, so later revisions map it from that point.
--
-- Tenancy follows 0007: every row names its workspace and binds to its
-- project, output, revision and suggestion through (workspace_id, id). The
-- status vocabularies are CHECKs (0014) and every reference a project
-- deletion follows is indexed (0018).

-- (workspace_id, id) keys so a suggestion can bind to its output and revision
-- within the workspace. `id` is already each table's primary key.
ALTER TABLE public.agent_outputs
    ADD CONSTRAINT uq_agent_outputs_ws_id UNIQUE (workspace_id, id);
ALTER TABLE public.agent_output_revisions
    ADD CONSTRAINT uq_agent_output_revisions_ws_id UNIQUE (workspace_id, id);

-- `anchor` is `{kind: 'span', position: {start, end}, quote: {exact, prefix,
-- suffix}}`, `{kind: 'field', field, expected}` or `{kind: 'page'}`;
-- `depends_on` lists what the judgement read. A suggestion has a replacement,
-- a question for the person (`needs_input`), or neither (advice), never both.
-- `run_id`/`message_id` are the Agent turn that wrote a `model` suggestion;
-- `snapshot_id` and `rule_version` are the fetch and Site Health rule behind a
-- `site_health` one.
CREATE TABLE public.agent_output_suggestions (
    id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    project_id uuid NOT NULL,
    output_id uuid NOT NULL,
    revision_id uuid NOT NULL,
    anchor_kind text NOT NULL,
    anchor jsonb NOT NULL,
    depends_on jsonb NOT NULL,
    replacement text,
    needs_input text,
    category text NOT NULL,
    rule_id text NOT NULL,
    rationale text NOT NULL,
    source text NOT NULL,
    run_id uuid,
    message_id uuid,
    snapshot_id uuid,
    rule_version text,
    created_at timestamp with time zone NOT NULL,
    CONSTRAINT agent_output_suggestions_pkey PRIMARY KEY (id),
    CONSTRAINT uq_agent_output_suggestions_ws_id UNIQUE (workspace_id, id),
    CONSTRAINT ck_agent_output_suggestions_anchor_kind CHECK (anchor_kind IN ('span', 'field', 'page')),
    CONSTRAINT ck_agent_output_suggestions_source CHECK (source IN ('model', 'site_health')),
    CONSTRAINT ck_agent_output_suggestions_one_ask CHECK (replacement IS NULL OR needs_input IS NULL),
    CONSTRAINT agent_output_suggestions_workspace_id_project_id_fkey FOREIGN KEY (workspace_id, project_id)
        REFERENCES public.projects(workspace_id, id) ON DELETE CASCADE,
    CONSTRAINT agent_output_suggestions_output_fkey FOREIGN KEY (workspace_id, output_id)
        REFERENCES public.agent_outputs(workspace_id, id) ON DELETE CASCADE,
    CONSTRAINT agent_output_suggestions_revision_fkey FOREIGN KEY (workspace_id, revision_id)
        REFERENCES public.agent_output_revisions(workspace_id, id) ON DELETE CASCADE,
    CONSTRAINT agent_output_suggestions_run_id_fkey FOREIGN KEY (run_id)
        REFERENCES public.agent_runs(id) ON DELETE SET NULL,
    CONSTRAINT agent_output_suggestions_message_id_fkey FOREIGN KEY (message_id)
        REFERENCES public.agent_messages(id) ON DELETE SET NULL,
    CONSTRAINT agent_output_suggestions_snapshot_id_fkey FOREIGN KEY (snapshot_id)
        REFERENCES public.page_snapshots(id) ON DELETE SET NULL
);
CREATE INDEX ix_agent_output_suggestions_project_id
    ON public.agent_output_suggestions USING btree (workspace_id, project_id);
CREATE INDEX ix_agent_output_suggestions_output_created
    ON public.agent_output_suggestions USING btree (output_id, created_at, id);
CREATE INDEX ix_agent_output_suggestions_revision_id
    ON public.agent_output_suggestions USING btree (revision_id);
CREATE INDEX ix_agent_output_suggestions_run_id
    ON public.agent_output_suggestions USING btree (run_id)
    WHERE run_id IS NOT NULL;
CREATE INDEX ix_agent_output_suggestions_message_id
    ON public.agent_output_suggestions USING btree (message_id)
    WHERE message_id IS NOT NULL;
CREATE INDEX ix_agent_output_suggestions_snapshot_id
    ON public.agent_output_suggestions USING btree (snapshot_id)
    WHERE snapshot_id IS NOT NULL;

-- One status change, numbered per suggestion. `revision_id` and the position
-- say where the suggestion's text lives after an `open`, `applied` or
-- `reverted` event (the replacement, once applied); a dismissal or a stale
-- mark names none. `reason` says why a suggestion went stale.
CREATE TABLE public.agent_output_suggestion_events (
    id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    project_id uuid NOT NULL,
    suggestion_id uuid NOT NULL,
    sequence integer NOT NULL,
    status text NOT NULL,
    actor text NOT NULL,
    actor_user_id uuid,
    run_id uuid,
    revision_id uuid,
    position_start integer,
    position_end integer,
    reason text,
    created_at timestamp with time zone NOT NULL,
    CONSTRAINT agent_output_suggestion_events_pkey PRIMARY KEY (id),
    CONSTRAINT uq_agent_output_suggestion_events_sequence UNIQUE (suggestion_id, sequence),
    CONSTRAINT ck_agent_output_suggestion_events_status CHECK (status IN (
        'open', 'applied', 'dismissed', 'reverted', 'stale'
    )),
    CONSTRAINT ck_agent_output_suggestion_events_actor CHECK (actor IN ('agent', 'user', 'system')),
    CONSTRAINT ck_agent_output_suggestion_events_position CHECK (
        (position_start IS NULL) = (position_end IS NULL)
        AND (position_start IS NULL OR (0 <= position_start AND position_start <= position_end))
    ),
    CONSTRAINT agent_output_suggestion_events_workspace_id_project_id_fkey FOREIGN KEY (workspace_id, project_id)
        REFERENCES public.projects(workspace_id, id) ON DELETE CASCADE,
    CONSTRAINT agent_output_suggestion_events_suggestion_fkey FOREIGN KEY (workspace_id, suggestion_id)
        REFERENCES public.agent_output_suggestions(workspace_id, id) ON DELETE CASCADE,
    CONSTRAINT agent_output_suggestion_events_revision_fkey FOREIGN KEY (workspace_id, revision_id)
        REFERENCES public.agent_output_revisions(workspace_id, id) ON DELETE CASCADE,
    CONSTRAINT agent_output_suggestion_events_run_id_fkey FOREIGN KEY (run_id)
        REFERENCES public.agent_runs(id) ON DELETE SET NULL,
    CONSTRAINT agent_output_suggestion_events_actor_user_id_fkey FOREIGN KEY (actor_user_id)
        REFERENCES public.users(id) ON DELETE SET NULL
);
CREATE INDEX ix_agent_output_suggestion_events_project_id
    ON public.agent_output_suggestion_events USING btree (workspace_id, project_id);
CREATE INDEX ix_agent_output_suggestion_events_revision_id
    ON public.agent_output_suggestion_events USING btree (revision_id)
    WHERE revision_id IS NOT NULL;
CREATE INDEX ix_agent_output_suggestion_events_run_id
    ON public.agent_output_suggestion_events USING btree (run_id)
    WHERE run_id IS NOT NULL;
