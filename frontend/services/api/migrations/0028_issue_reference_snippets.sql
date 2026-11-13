-- Issue reference snippets (backlog implementation E1, BL3). Forward-only and
-- safe on existing rows.
--
-- Each finding class's catalog row keeps at most one bounded, redacted HTML
-- reference snippet per issue family (rule) of the crawl: the first affected
-- page in URL order whose fetched facts carry one, with the page URL and the
-- exact issue and fetch artifact it came from. An existing row has none.

ALTER TABLE public.site_issue_catalogs
    ADD COLUMN reference_snippets jsonb DEFAULT '[]'::jsonb NOT NULL;
