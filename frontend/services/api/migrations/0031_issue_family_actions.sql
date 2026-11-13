-- Issue-family Actions. Forward-only and safe on
-- existing rows.
--
-- One Action can carry one Site Health issue family: one rule across the pages
-- it fails on. `cohort` is that family as the latest refresh grouped it: the
-- rule, the crawl it was read from, the affected page count and the bounded
-- page list a declaration freezes. Only an issue-family Action has one, and a
-- refresh that resolves the family keeps the last cohort, like the Action's
-- last member set.

ALTER TABLE public.actions
    ADD COLUMN cohort jsonb,
    ADD CONSTRAINT ck_actions_cohort CHECK (((target_kind)::text = 'issue_family') = (cohort IS NOT NULL));
