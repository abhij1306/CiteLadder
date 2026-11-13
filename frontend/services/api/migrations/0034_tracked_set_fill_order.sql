-- Tracked pages.
-- Forward-only and safe on existing rows. Greenfield: no backfill.
--
-- A project's tracked pages are its active monitored_site_urls rows with a
-- fill_order: the position in which the system picked the page (the root
-- first, then value tiers, then the URL hash). The monitored-URL limit is a
-- window over that order: lowering it deactivates the pages past it
-- (deselected_at is when the page left), raising it restores them, and a page
-- once tracked is never re-picked. selected_at is when it joined. A row
-- without a fill_order is a sample membership, or one picked before this
-- migration, and is not tracked.
--
-- The HTML-walk frontier is admitted in the same stable order (value tier,
-- then URL hash), so its pending index now holds exactly that order instead
-- of a per-crawl hash each admission computed and sorted.

ALTER TABLE public.monitored_site_urls
    ADD COLUMN fill_order integer,
    ADD CONSTRAINT ck_monitored_site_urls_fill_order CHECK (((fill_order IS NULL) OR (fill_order >= 0)));

CREATE UNIQUE INDEX uq_monitored_site_urls_fill_order ON public.monitored_site_urls USING btree (project_id, fill_order);

CREATE INDEX ix_site_discovery_frontier_pending_order ON public.site_discovery_frontier USING btree (crawl_id, status, value_priority DESC, url_hash);

DROP INDEX public.ix_site_discovery_frontier_pending;
