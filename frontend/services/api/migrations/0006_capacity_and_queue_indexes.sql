-- Indexes for the two hot paths that scanned whole tables. Forward-only and
-- safe on existing rows.
--
-- Capacity admission locks each bucket and sums its live leases
-- (providers/capacity.ts); only unreleased, unexpired leases count, so the
-- index holds exactly those rows. Released and long-expired leases are purged
-- by audit maintenance.
CREATE INDEX ix_provider_capacity_leases_live
    ON public.provider_capacity_leases USING btree (bucket_id, expires_at)
    WHERE released_at IS NULL;

-- Audit claims rank claimable tasks that are due (queue/audit-queue.ts).
CREATE INDEX ix_audit_tasks_status_available_at
    ON public.audit_tasks USING btree (status, available_at);
