-- Index the references that project deletion follows row by row. Forward-only
-- and safe on existing rows: indexes only, no data or constraint change.
--
-- Deleting a project (projects/service.ts removeProject) is one statement that
-- cascades through every owned table. PostgreSQL enforces each ON DELETE
-- CASCADE / SET NULL / NO ACTION reference with one lookup per deleted parent
-- row, so a reference column without an index costs a sequential scan of the
-- whole child table, every tenant's rows included, for each parent row. The
-- parents below gain rows per answer, task, fetched page, rule evaluation, URL
-- or metric row, so the deletion grew as (project size x table size) and
-- reached the request statement timeout: on a local database with 200k
-- citation-family rows, a project holding 72 answers spent 4.7 s in these
-- lookups alone.
--
-- Nullable references are indexed only where set; the RI lookup's equality
-- implies IS NOT NULL, so the partial index serves it. Parents with a bounded
-- row count per project (audits, crawls, prompts, snapshots of either) and the
-- user actor references are left as they are.

-- Answers: raw_response_artifacts, audit_tasks and the audit's frozen snapshots.
CREATE INDEX ix_citations_artifact_id
    ON public.citations USING btree (artifact_id);
CREATE INDEX ix_retrieved_sources_artifact_id
    ON public.retrieved_sources USING btree (artifact_id);
CREATE INDEX ix_brand_mentions_artifact_id
    ON public.brand_mentions USING btree (artifact_id);
CREATE INDEX ix_competitor_mentions_artifact_id
    ON public.competitor_mentions USING btree (artifact_id);
CREATE INDEX ix_response_analyses_artifact_id
    ON public.response_analyses USING btree (artifact_id);
CREATE INDEX ix_answer_perceptions_artifact_id
    ON public.answer_perceptions USING btree (artifact_id);
CREATE INDEX ix_answer_perceptions_task_id
    ON public.answer_perceptions USING btree (task_id);
CREATE INDEX ix_provider_attempts_artifact_id
    ON public.provider_attempts USING btree (artifact_id)
    WHERE artifact_id IS NOT NULL;
CREATE INDEX ix_audit_tasks_result_artifact_id
    ON public.audit_tasks USING btree (result_artifact_id)
    WHERE result_artifact_id IS NOT NULL;
CREATE INDEX ix_audit_tasks_prompt_snapshot_id
    ON public.audit_tasks USING btree (prompt_snapshot_id);
CREATE INDEX ix_audit_tasks_engine_snapshot_id
    ON public.audit_tasks USING btree (engine_snapshot_id);

-- Site Health: fetched pages, page analyses, rule evaluations, crawl tasks.
CREATE INDEX ix_site_issues_source_artifact_id
    ON public.site_issues USING btree (source_artifact_id);
CREATE INDEX ix_site_fetch_attempts_artifact_id
    ON public.site_fetch_attempts USING btree (artifact_id)
    WHERE artifact_id IS NOT NULL;
CREATE INDEX ix_site_url_observations_source_artifact_id
    ON public.site_url_observations USING btree (source_artifact_id)
    WHERE source_artifact_id IS NOT NULL;
CREATE INDEX ix_site_crawl_tasks_result_artifact_id
    ON public.site_crawl_tasks USING btree (result_artifact_id)
    WHERE result_artifact_id IS NOT NULL;
CREATE INDEX ix_site_crawl_tasks_source_task_id
    ON public.site_crawl_tasks USING btree (source_task_id)
    WHERE source_task_id IS NOT NULL;
CREATE INDEX ix_commerce_product_observations_source_artifact_id
    ON public.commerce_product_observations USING btree (source_artifact_id)
    WHERE source_artifact_id IS NOT NULL;
CREATE INDEX ix_commerce_categories_source_analysis_id
    ON public.commerce_categories USING btree (source_analysis_id)
    WHERE source_analysis_id IS NOT NULL;
CREATE INDEX ix_site_change_observations_artifact_a
    ON public.site_change_observations USING btree (source_artifact_a_id)
    WHERE source_artifact_a_id IS NOT NULL;
CREATE INDEX ix_site_change_observations_artifact_b
    ON public.site_change_observations USING btree (source_artifact_b_id)
    WHERE source_artifact_b_id IS NOT NULL;
CREATE INDEX ix_site_change_observations_analysis_a
    ON public.site_change_observations USING btree (source_analysis_a_id)
    WHERE source_analysis_a_id IS NOT NULL;
CREATE INDEX ix_site_change_observations_analysis_b
    ON public.site_change_observations USING btree (source_analysis_b_id)
    WHERE source_analysis_b_id IS NOT NULL;
CREATE INDEX ix_site_change_observations_evaluation_a
    ON public.site_change_observations USING btree (source_evaluation_a_id)
    WHERE source_evaluation_a_id IS NOT NULL;
CREATE INDEX ix_site_change_observations_evaluation_b
    ON public.site_change_observations USING btree (source_evaluation_b_id)
    WHERE source_evaluation_b_id IS NOT NULL;

-- Site URLs: one per discovered URL, up to the discovery limit per project.
CREATE INDEX ix_site_crawl_tasks_parent_site_url_id
    ON public.site_crawl_tasks USING btree (parent_site_url_id)
    WHERE parent_site_url_id IS NOT NULL;
CREATE INDEX ix_site_url_observations_parent_site_url_id
    ON public.site_url_observations USING btree (parent_site_url_id)
    WHERE parent_site_url_id IS NOT NULL;
CREATE INDEX ix_traffic_page_stats_site_url_id
    ON public.traffic_page_stats USING btree (site_url_id)
    WHERE site_url_id IS NOT NULL;
CREATE INDEX ix_query_evidence_rows_site_url_id
    ON public.query_evidence_rows USING btree (site_url_id)
    WHERE site_url_id IS NOT NULL;
CREATE INDEX ix_content_differentiation_reports_owned_site_url_id
    ON public.content_differentiation_reports USING btree (owned_site_url_id)
    WHERE owned_site_url_id IS NOT NULL;

-- Connected data and Opportunities: imported metric rows and superseded rows.
CREATE INDEX ix_referral_events_source_metric_row_id
    ON public.referral_events USING btree (source_metric_row_id)
    WHERE source_metric_row_id IS NOT NULL;
CREATE INDEX ix_opportunities_superseded_by_id
    ON public.opportunities USING btree (superseded_by_id)
    WHERE superseded_by_id IS NOT NULL;
