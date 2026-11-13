-- Deployment record. Forward-only and safe on
-- existing rows.
--
-- A declaration is the Action's recorded deployment step: its
-- `declared_implemented_at` is when the fix shipped (the go-live that fixes the
-- baseline) and its `actor_user_id` is the authenticated person who recorded
-- it. `deployment_reference` adds what shipped it, such as a release, pull
-- request or commit, as the person typed it. Null when none was given, and on
-- every declaration recorded before this column existed.

ALTER TABLE public.opportunity_implementation_events
    ADD COLUMN deployment_reference text,
    ADD CONSTRAINT ck_opportunity_implementation_deployment_reference CHECK (((deployment_reference IS NULL) OR ((char_length(deployment_reference) >= 1) AND (char_length(deployment_reference) <= 500))));
