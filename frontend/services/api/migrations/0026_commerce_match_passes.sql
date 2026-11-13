-- Match the catalog in every answer. Forward-only and safe on existing rows.
--
-- A catalog revision is an immutable copy of a project's matching identity:
-- its active products (with category memberships) and approved competitors,
-- numbered per project and recording the import, projection, competitor
-- decision or audit admission that created it. A new revision is written only
-- when that identity changed (`identity_hash`).
--
-- A match pass is one derivation of shelf observations from one stored answer
-- under one catalog revision and one parser/matcher version pair. `live`
-- passes are written with the answer; `backfill` passes re-derive stored
-- answers deterministically after a new revision. The raw answer is never
-- rewritten; reads use the latest pass per answer and keep older passes as
-- history. `target_*` is set when a buyer prompt targets the answer and null
-- for answers no buyer prompt targets (brand runs).
--
-- Tenancy follows 0007, statuses are CHECKs (0014) and every reference a
-- project deletion follows is indexed (0018).

CREATE TABLE public.commerce_catalog_revisions (
    id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    project_id uuid NOT NULL,
    revision_number integer NOT NULL,
    identity_snapshot jsonb NOT NULL,
    identity_hash character varying(64) NOT NULL,
    source_kind character varying(24) NOT NULL,
    source_id uuid,
    created_at timestamp with time zone NOT NULL,
    CONSTRAINT commerce_catalog_revisions_pkey PRIMARY KEY (id),
    CONSTRAINT uq_commerce_catalog_revisions_ws_id UNIQUE (workspace_id, id),
    CONSTRAINT uq_commerce_catalog_revisions_number UNIQUE (workspace_id, project_id, revision_number),
    CONSTRAINT ck_commerce_catalog_revisions_number CHECK (revision_number >= 1),
    CONSTRAINT ck_commerce_catalog_revisions_source CHECK (source_kind IN (
        'import', 'projection', 'competitor_decision', 'edit', 'audit'
    )),
    CONSTRAINT commerce_catalog_revisions_workspace_id_project_id_fkey FOREIGN KEY (workspace_id, project_id)
        REFERENCES public.projects(workspace_id, id) ON DELETE CASCADE
);

-- `catalog_revision_id` is null only for the passes this migration records for
-- observations written before revisions existed.
CREATE TABLE public.commerce_match_passes (
    id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    project_id uuid NOT NULL,
    audit_id uuid NOT NULL,
    task_id uuid NOT NULL,
    artifact_id uuid NOT NULL,
    catalog_revision_id uuid,
    target_kind character varying(16),
    target_id uuid,
    parser_version character varying(64) NOT NULL,
    matcher_version character varying(64) NOT NULL,
    mode character varying(16) NOT NULL,
    created_at timestamp with time zone NOT NULL,
    CONSTRAINT commerce_match_passes_pkey PRIMARY KEY (id),
    CONSTRAINT uq_commerce_match_passes_ws_id UNIQUE (workspace_id, id),
    CONSTRAINT ck_commerce_match_passes_mode CHECK (mode IN ('live', 'backfill')),
    CONSTRAINT ck_commerce_match_passes_target CHECK ((target_kind IS NULL) = (target_id IS NULL)),
    CONSTRAINT commerce_match_passes_workspace_id_project_id_fkey FOREIGN KEY (workspace_id, project_id)
        REFERENCES public.projects(workspace_id, id) ON DELETE CASCADE,
    CONSTRAINT commerce_match_passes_revision_fkey FOREIGN KEY (workspace_id, catalog_revision_id)
        REFERENCES public.commerce_catalog_revisions(workspace_id, id) ON DELETE CASCADE,
    CONSTRAINT commerce_match_passes_audit_id_fkey FOREIGN KEY (audit_id)
        REFERENCES public.audits(id) ON DELETE CASCADE,
    CONSTRAINT commerce_match_passes_task_id_fkey FOREIGN KEY (task_id)
        REFERENCES public.audit_tasks(id) ON DELETE CASCADE,
    CONSTRAINT commerce_match_passes_artifact_id_fkey FOREIGN KEY (artifact_id)
        REFERENCES public.raw_response_artifacts(id) ON DELETE CASCADE
);
-- One pass per answer, revision and versions: a repeated derivation is a no-op.
CREATE UNIQUE INDEX uq_commerce_match_passes_derivation
    ON public.commerce_match_passes (artifact_id, catalog_revision_id, parser_version, matcher_version)
    WHERE catalog_revision_id IS NOT NULL;
CREATE UNIQUE INDEX uq_commerce_match_passes_unrevised
    ON public.commerce_match_passes (artifact_id, parser_version, matcher_version)
    WHERE catalog_revision_id IS NULL;
CREATE INDEX ix_commerce_match_passes_project_id
    ON public.commerce_match_passes USING btree (workspace_id, project_id);
CREATE INDEX ix_commerce_match_passes_revision_id
    ON public.commerce_match_passes USING btree (catalog_revision_id)
    WHERE catalog_revision_id IS NOT NULL;
CREATE INDEX ix_commerce_match_passes_audit_id
    ON public.commerce_match_passes USING btree (audit_id);
CREATE INDEX ix_commerce_match_passes_task_id
    ON public.commerce_match_passes USING btree (task_id);

-- Observations written before this migration get one live pass per answer and
-- version pair, so every observation references a pass.
ALTER TABLE public.commerce_recommendation_observations
    ADD COLUMN pass_id uuid;
INSERT INTO public.commerce_match_passes (
    id, workspace_id, project_id, audit_id, task_id, artifact_id, catalog_revision_id,
    target_kind, target_id, parser_version, matcher_version, mode, created_at
)
SELECT DISTINCT ON (artifact_id, parser_version, matcher_version)
    gen_random_uuid(), workspace_id, project_id, audit_id, task_id, artifact_id, NULL,
    target_kind, target_id, parser_version, matcher_version, 'live', created_at
FROM public.commerce_recommendation_observations
ORDER BY artifact_id, parser_version, matcher_version, created_at, id;
UPDATE public.commerce_recommendation_observations AS o
    SET pass_id = p.id
    FROM public.commerce_match_passes AS p
    WHERE p.artifact_id = o.artifact_id
      AND p.parser_version = o.parser_version
      AND p.matcher_version = o.matcher_version;
ALTER TABLE public.commerce_recommendation_observations
    ALTER COLUMN pass_id SET NOT NULL,
    ALTER COLUMN target_kind DROP NOT NULL,
    ALTER COLUMN target_id DROP NOT NULL,
    ADD CONSTRAINT ck_commerce_observation_target CHECK ((target_kind IS NULL) = (target_id IS NULL)),
    ADD CONSTRAINT commerce_recommendation_observations_pass_fkey FOREIGN KEY (workspace_id, pass_id)
        REFERENCES public.commerce_match_passes(workspace_id, id) ON DELETE CASCADE;
CREATE INDEX ix_commerce_recommendation_observations_pass_id
    ON public.commerce_recommendation_observations USING btree (pass_id);
