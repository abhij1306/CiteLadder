-- Declaration ordering (backlog implementation A1). Forward-only and safe on
-- existing rows.
--
-- An Action keeps the last non-empty member set it carried, so a finding a
-- recrawl resolved can still be declared: the declaration freezes those
-- members instead of being refused for an Action whose current members are
-- empty.
--
-- A declaration's baseline is the newest Opportunity snapshot at or before the
-- declared go-live; with none, the baseline is unavailable and the snapshot id
-- is null. When the refresh that resolved the declared findings committed at or
-- before go-live, `resolved_before_snapshot_id` names that snapshot: the
-- outcome is resolved before the declared deployment and is never credited to
-- it. Null means the findings were still live at go-live.

ALTER TABLE public.actions
    ADD COLUMN last_member_opportunity_ids jsonb DEFAULT '[]'::jsonb NOT NULL;

ALTER TABLE public.opportunity_implementation_events
    ALTER COLUMN opportunity_snapshot_id DROP NOT NULL,
    ADD COLUMN resolved_before_snapshot_id uuid,
    ADD CONSTRAINT opportunity_implementation_events_resolved_before_snapshot_id_fkey FOREIGN KEY (resolved_before_snapshot_id) REFERENCES public.opportunity_snapshots(id);

CREATE INDEX ix_opportunity_implementation_events_resolved_before_snapshot_id ON public.opportunity_implementation_events USING btree (resolved_before_snapshot_id);
