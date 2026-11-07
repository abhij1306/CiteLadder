-- Content differentiation reports become insert-only derived results: a refresh
-- appends a new report instead of overwriting the task's report in place, and
-- reads take each task's newest. Forward-only and safe on existing rows, which
-- stay as each task's only (and so newest) report.
ALTER TABLE public.content_differentiation_reports
    DROP CONSTRAINT uq_content_diff_report_task;
CREATE INDEX ix_content_diff_report_task_latest
    ON public.content_differentiation_reports USING btree (audit_task_id, formula_version, created_at DESC, id DESC);
