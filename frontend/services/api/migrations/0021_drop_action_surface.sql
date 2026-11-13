-- Drop the Action surface (Actions simplification PR 1, AS1). There is one
-- Actions list again, so no read filters or counts Actions by screen and no
-- refresh derives a surface. Forward-only: the index, the CHECK and the column
-- that 0020 added go; no other row data changes.
DROP INDEX public.ix_actions_project_surface_status;

ALTER TABLE public.actions
    DROP CONSTRAINT ck_actions_surface,
    DROP COLUMN surface;
