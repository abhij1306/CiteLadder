-- Action surface (content optimization phase 1, PR 2). Forward-only and safe on
-- existing rows: one new column with a default, its CHECK and one index.
--
-- `surface` names the screen an Action belongs to: `content` for an owned page
-- whose current Site Health page kind is a content kind and for a planned page
-- with a `content_gap_new_page` member, `actions` for everything else. Action
-- sync derives and restamps it on every refresh; the list filter and its
-- status counts read the column. Existing rows read `actions` until the next
-- refresh restamps them (no backfill).
ALTER TABLE public.actions
    ADD COLUMN surface text NOT NULL DEFAULT 'actions',
    ADD CONSTRAINT ck_actions_surface CHECK (surface IN ('actions', 'content'));

CREATE INDEX ix_actions_project_surface_status
    ON public.actions USING btree (workspace_id, project_id, surface, effective_status);
