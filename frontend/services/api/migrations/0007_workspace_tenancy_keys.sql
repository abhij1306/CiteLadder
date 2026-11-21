-- Tenancy in the schema: a project-owned row names its workspace, and the
-- database refuses a row whose project belongs to another workspace.
-- Forward-only. Production tables are empty; on a database that has rows, the
-- new workspace_id columns take the owning project's (or set's) workspace.
--
-- 1. Project-owned tables that had no workspace_id gain one, bound to the
--    project through projects(workspace_id, id).

ALTER TABLE public.brands ADD COLUMN workspace_id uuid;
UPDATE public.brands AS t SET workspace_id = p.workspace_id
    FROM public.projects AS p WHERE p.id = t.project_id;
ALTER TABLE public.brands
    ALTER COLUMN workspace_id SET NOT NULL,
    DROP CONSTRAINT brands_project_id_fkey,
    ADD CONSTRAINT brands_workspace_id_project_id_fkey FOREIGN KEY (workspace_id, project_id) REFERENCES public.projects(workspace_id, id) ON DELETE CASCADE;
CREATE INDEX ix_brands_workspace_id_project_id ON public.brands USING btree (workspace_id, project_id);

ALTER TABLE public.competitors ADD COLUMN workspace_id uuid;
UPDATE public.competitors AS t SET workspace_id = p.workspace_id
    FROM public.projects AS p WHERE p.id = t.project_id;
ALTER TABLE public.competitors
    ALTER COLUMN workspace_id SET NOT NULL,
    DROP CONSTRAINT competitors_project_id_fkey,
    ADD CONSTRAINT competitors_workspace_id_project_id_fkey FOREIGN KEY (workspace_id, project_id) REFERENCES public.projects(workspace_id, id) ON DELETE CASCADE;
CREATE INDEX ix_competitors_workspace_id_project_id ON public.competitors USING btree (workspace_id, project_id);

ALTER TABLE public.owned_domains ADD COLUMN workspace_id uuid;
UPDATE public.owned_domains AS t SET workspace_id = p.workspace_id
    FROM public.projects AS p WHERE p.id = t.project_id;
ALTER TABLE public.owned_domains
    ALTER COLUMN workspace_id SET NOT NULL,
    DROP CONSTRAINT owned_domains_project_id_fkey,
    ADD CONSTRAINT owned_domains_workspace_id_project_id_fkey FOREIGN KEY (workspace_id, project_id) REFERENCES public.projects(workspace_id, id) ON DELETE CASCADE;
CREATE INDEX ix_owned_domains_workspace_id_project_id ON public.owned_domains USING btree (workspace_id, project_id);

ALTER TABLE public.prompt_sets ADD COLUMN workspace_id uuid;
UPDATE public.prompt_sets AS t SET workspace_id = p.workspace_id
    FROM public.projects AS p WHERE p.id = t.project_id;
ALTER TABLE public.prompt_sets
    ALTER COLUMN workspace_id SET NOT NULL,
    DROP CONSTRAINT prompt_sets_project_id_fkey,
    ADD CONSTRAINT prompt_sets_workspace_id_project_id_fkey FOREIGN KEY (workspace_id, project_id) REFERENCES public.projects(workspace_id, id) ON DELETE CASCADE,
    ADD CONSTRAINT uq_prompt_sets_ws_id UNIQUE (workspace_id, id);
CREATE INDEX ix_prompt_sets_workspace_id_project_id ON public.prompt_sets USING btree (workspace_id, project_id);

ALTER TABLE public.topics ADD COLUMN workspace_id uuid;
UPDATE public.topics AS t SET workspace_id = p.workspace_id
    FROM public.projects AS p WHERE p.id = t.project_id;
ALTER TABLE public.topics
    ALTER COLUMN workspace_id SET NOT NULL,
    DROP CONSTRAINT topics_project_id_fkey,
    ADD CONSTRAINT topics_workspace_id_project_id_fkey FOREIGN KEY (workspace_id, project_id) REFERENCES public.projects(workspace_id, id) ON DELETE CASCADE;
CREATE INDEX ix_topics_workspace_id_project_id ON public.topics USING btree (workspace_id, project_id);

ALTER TABLE public.unintended_domains ADD COLUMN workspace_id uuid;
UPDATE public.unintended_domains AS t SET workspace_id = p.workspace_id
    FROM public.projects AS p WHERE p.id = t.project_id;
ALTER TABLE public.unintended_domains
    ALTER COLUMN workspace_id SET NOT NULL,
    DROP CONSTRAINT unintended_domains_project_id_fkey,
    ADD CONSTRAINT unintended_domains_workspace_id_project_id_fkey FOREIGN KEY (workspace_id, project_id) REFERENCES public.projects(workspace_id, id) ON DELETE CASCADE;
CREATE INDEX ix_unintended_domains_workspace_id_project_id ON public.unintended_domains USING btree (workspace_id, project_id);

-- 2. Prompts belong to their project through their set: the workspace binds
--    to prompt_sets(workspace_id, id).

ALTER TABLE public.prompts ADD COLUMN workspace_id uuid;
UPDATE public.prompts AS t SET workspace_id = s.workspace_id
    FROM public.prompt_sets AS s WHERE s.id = t.prompt_set_id;
ALTER TABLE public.prompts
    ALTER COLUMN workspace_id SET NOT NULL,
    DROP CONSTRAINT prompts_prompt_set_id_fkey,
    ADD CONSTRAINT prompts_workspace_id_prompt_set_id_fkey FOREIGN KEY (workspace_id, prompt_set_id) REFERENCES public.prompt_sets(workspace_id, id) ON DELETE CASCADE;
CREATE INDEX ix_prompts_workspace_id_prompt_set_id ON public.prompts USING btree (workspace_id, prompt_set_id);

-- 3. Tables that carried workspace_id beside a project_id-only key: the key
--    now names both, with the same ON DELETE CASCADE. (Tables keyed to a
--    project-owned parent by (workspace_id, project_id, ...) are bound through
--    that parent; agent_model_attempts stays keyed to its workspace only.)

ALTER TABLE public.action_status_events
    DROP CONSTRAINT action_status_events_project_id_fkey,
    ADD CONSTRAINT action_status_events_workspace_id_project_id_fkey FOREIGN KEY (workspace_id, project_id) REFERENCES public.projects(workspace_id, id) ON DELETE CASCADE;
ALTER TABLE public.actions
    DROP CONSTRAINT actions_project_id_fkey,
    ADD CONSTRAINT actions_workspace_id_project_id_fkey FOREIGN KEY (workspace_id, project_id) REFERENCES public.projects(workspace_id, id) ON DELETE CASCADE;
ALTER TABLE public.agent_chats
    DROP CONSTRAINT agent_chats_project_id_fkey,
    ADD CONSTRAINT agent_chats_workspace_id_project_id_fkey FOREIGN KEY (workspace_id, project_id) REFERENCES public.projects(workspace_id, id) ON DELETE CASCADE;
ALTER TABLE public.agent_instruction_revisions
    DROP CONSTRAINT agent_instruction_revisions_project_id_fkey,
    ADD CONSTRAINT agent_instruction_revisions_workspace_id_project_id_fkey FOREIGN KEY (workspace_id, project_id) REFERENCES public.projects(workspace_id, id) ON DELETE CASCADE;
ALTER TABLE public.agent_messages
    DROP CONSTRAINT agent_messages_project_id_fkey,
    ADD CONSTRAINT agent_messages_workspace_id_project_id_fkey FOREIGN KEY (workspace_id, project_id) REFERENCES public.projects(workspace_id, id) ON DELETE CASCADE;
ALTER TABLE public.agent_output_revisions
    DROP CONSTRAINT agent_output_revisions_project_id_fkey,
    ADD CONSTRAINT agent_output_revisions_workspace_id_project_id_fkey FOREIGN KEY (workspace_id, project_id) REFERENCES public.projects(workspace_id, id) ON DELETE CASCADE;
ALTER TABLE public.agent_outputs
    DROP CONSTRAINT agent_outputs_project_id_fkey,
    ADD CONSTRAINT agent_outputs_workspace_id_project_id_fkey FOREIGN KEY (workspace_id, project_id) REFERENCES public.projects(workspace_id, id) ON DELETE CASCADE;
ALTER TABLE public.agent_runs
    DROP CONSTRAINT agent_runs_project_id_fkey,
    ADD CONSTRAINT agent_runs_workspace_id_project_id_fkey FOREIGN KEY (workspace_id, project_id) REFERENCES public.projects(workspace_id, id) ON DELETE CASCADE;
ALTER TABLE public.agent_run_transcripts
    DROP CONSTRAINT agent_run_transcripts_project_id_fkey,
    ADD CONSTRAINT agent_run_transcripts_workspace_id_project_id_fkey FOREIGN KEY (workspace_id, project_id) REFERENCES public.projects(workspace_id, id) ON DELETE CASCADE;
ALTER TABLE public.agent_tool_attempts
    DROP CONSTRAINT agent_tool_attempts_project_id_fkey,
    ADD CONSTRAINT agent_tool_attempts_workspace_id_project_id_fkey FOREIGN KEY (workspace_id, project_id) REFERENCES public.projects(workspace_id, id) ON DELETE CASCADE;
ALTER TABLE public.ai_referrals_snapshots
    DROP CONSTRAINT ai_referrals_snapshots_project_id_fkey,
    ADD CONSTRAINT ai_referrals_snapshots_workspace_id_project_id_fkey FOREIGN KEY (workspace_id, project_id) REFERENCES public.projects(workspace_id, id) ON DELETE CASCADE;
ALTER TABLE public.analytics_tasks
    DROP CONSTRAINT analytics_tasks_project_id_fkey,
    ADD CONSTRAINT analytics_tasks_workspace_id_project_id_fkey FOREIGN KEY (workspace_id, project_id) REFERENCES public.projects(workspace_id, id) ON DELETE CASCADE;
ALTER TABLE public.audit_answer_aggregates
    DROP CONSTRAINT audit_answer_aggregates_project_id_fkey,
    ADD CONSTRAINT audit_answer_aggregates_workspace_id_project_id_fkey FOREIGN KEY (workspace_id, project_id) REFERENCES public.projects(workspace_id, id) ON DELETE CASCADE;
ALTER TABLE public.audit_comparison_baselines
    DROP CONSTRAINT audit_comparison_baselines_project_id_fkey,
    ADD CONSTRAINT audit_comparison_baselines_workspace_id_project_id_fkey FOREIGN KEY (workspace_id, project_id) REFERENCES public.projects(workspace_id, id) ON DELETE CASCADE;
ALTER TABLE public.audit_schedules
    DROP CONSTRAINT audit_schedules_project_id_fkey,
    ADD CONSTRAINT audit_schedules_workspace_id_project_id_fkey FOREIGN KEY (workspace_id, project_id) REFERENCES public.projects(workspace_id, id) ON DELETE CASCADE;
ALTER TABLE public.audit_source_aggregates
    DROP CONSTRAINT audit_source_aggregates_project_id_fkey,
    ADD CONSTRAINT audit_source_aggregates_workspace_id_project_id_fkey FOREIGN KEY (workspace_id, project_id) REFERENCES public.projects(workspace_id, id) ON DELETE CASCADE;
ALTER TABLE public.audit_tasks
    DROP CONSTRAINT audit_tasks_project_id_fkey,
    ADD CONSTRAINT audit_tasks_workspace_id_project_id_fkey FOREIGN KEY (workspace_id, project_id) REFERENCES public.projects(workspace_id, id) ON DELETE CASCADE;
ALTER TABLE public.brand_discoveries
    DROP CONSTRAINT brand_discoveries_project_id_fkey,
    ADD CONSTRAINT brand_discoveries_workspace_id_project_id_fkey FOREIGN KEY (workspace_id, project_id) REFERENCES public.projects(workspace_id, id) ON DELETE CASCADE;
ALTER TABLE public.brand_profiles
    DROP CONSTRAINT brand_profiles_project_id_fkey,
    ADD CONSTRAINT brand_profiles_workspace_id_project_id_fkey FOREIGN KEY (workspace_id, project_id) REFERENCES public.projects(workspace_id, id) ON DELETE CASCADE;
ALTER TABLE public.branded_query_overrides
    DROP CONSTRAINT branded_query_overrides_project_id_fkey,
    ADD CONSTRAINT branded_query_overrides_workspace_id_project_id_fkey FOREIGN KEY (workspace_id, project_id) REFERENCES public.projects(workspace_id, id) ON DELETE CASCADE;
ALTER TABLE public.commerce_categories
    DROP CONSTRAINT commerce_categories_project_id_fkey,
    ADD CONSTRAINT commerce_categories_workspace_id_project_id_fkey FOREIGN KEY (workspace_id, project_id) REFERENCES public.projects(workspace_id, id) ON DELETE CASCADE;
ALTER TABLE public.commerce_competitor_attempts
    DROP CONSTRAINT commerce_competitor_attempts_project_id_fkey,
    ADD CONSTRAINT commerce_competitor_attempts_workspace_id_project_id_fkey FOREIGN KEY (workspace_id, project_id) REFERENCES public.projects(workspace_id, id) ON DELETE CASCADE;
ALTER TABLE public.commerce_competitor_candidates
    DROP CONSTRAINT commerce_competitor_candidates_project_id_fkey,
    ADD CONSTRAINT commerce_competitor_candidates_workspace_id_project_id_fkey FOREIGN KEY (workspace_id, project_id) REFERENCES public.projects(workspace_id, id) ON DELETE CASCADE;
ALTER TABLE public.commerce_csv_imports
    DROP CONSTRAINT commerce_csv_imports_project_id_fkey,
    ADD CONSTRAINT commerce_csv_imports_workspace_id_project_id_fkey FOREIGN KEY (workspace_id, project_id) REFERENCES public.projects(workspace_id, id) ON DELETE CASCADE;
ALTER TABLE public.commerce_product_categories
    DROP CONSTRAINT commerce_product_categories_project_id_fkey,
    ADD CONSTRAINT commerce_product_categories_workspace_id_project_id_fkey FOREIGN KEY (workspace_id, project_id) REFERENCES public.projects(workspace_id, id) ON DELETE CASCADE;
ALTER TABLE public.commerce_product_observations
    DROP CONSTRAINT commerce_product_observations_project_id_fkey,
    ADD CONSTRAINT commerce_product_observations_workspace_id_project_id_fkey FOREIGN KEY (workspace_id, project_id) REFERENCES public.projects(workspace_id, id) ON DELETE CASCADE;
ALTER TABLE public.commerce_products
    DROP CONSTRAINT commerce_products_project_id_fkey,
    ADD CONSTRAINT commerce_products_workspace_id_project_id_fkey FOREIGN KEY (workspace_id, project_id) REFERENCES public.projects(workspace_id, id) ON DELETE CASCADE;
ALTER TABLE public.commerce_prompt_targets
    DROP CONSTRAINT commerce_prompt_targets_project_id_fkey,
    ADD CONSTRAINT commerce_prompt_targets_workspace_id_project_id_fkey FOREIGN KEY (workspace_id, project_id) REFERENCES public.projects(workspace_id, id) ON DELETE CASCADE;
ALTER TABLE public.commerce_recommendation_observations
    DROP CONSTRAINT commerce_recommendation_observations_project_id_fkey,
    ADD CONSTRAINT fk_commerce_recommendation_observations_project FOREIGN KEY (workspace_id, project_id) REFERENCES public.projects(workspace_id, id) ON DELETE CASCADE;
ALTER TABLE public.commerce_shelf_snapshots
    DROP CONSTRAINT commerce_shelf_snapshots_project_id_fkey,
    ADD CONSTRAINT commerce_shelf_snapshots_workspace_id_project_id_fkey FOREIGN KEY (workspace_id, project_id) REFERENCES public.projects(workspace_id, id) ON DELETE CASCADE;
ALTER TABLE public.content_differentiation_candidates
    DROP CONSTRAINT content_differentiation_candidates_project_id_fkey,
    ADD CONSTRAINT content_differentiation_candidates_workspace_id_project_id_fkey FOREIGN KEY (workspace_id, project_id) REFERENCES public.projects(workspace_id, id) ON DELETE CASCADE;
ALTER TABLE public.content_differentiation_reports
    DROP CONSTRAINT content_differentiation_reports_project_id_fkey,
    ADD CONSTRAINT content_differentiation_reports_workspace_id_project_id_fkey FOREIGN KEY (workspace_id, project_id) REFERENCES public.projects(workspace_id, id) ON DELETE CASCADE;
ALTER TABLE public.demand_signals
    DROP CONSTRAINT demand_signals_project_id_fkey,
    ADD CONSTRAINT demand_signals_workspace_id_project_id_fkey FOREIGN KEY (workspace_id, project_id) REFERENCES public.projects(workspace_id, id) ON DELETE CASCADE;
ALTER TABLE public.demand_snapshots
    DROP CONSTRAINT demand_snapshots_project_id_fkey,
    ADD CONSTRAINT demand_snapshots_workspace_id_project_id_fkey FOREIGN KEY (workspace_id, project_id) REFERENCES public.projects(workspace_id, id) ON DELETE CASCADE;
ALTER TABLE public.integration_metric_rows
    DROP CONSTRAINT integration_metric_rows_project_id_fkey,
    ADD CONSTRAINT integration_metric_rows_workspace_id_project_id_fkey FOREIGN KEY (workspace_id, project_id) REFERENCES public.projects(workspace_id, id) ON DELETE CASCADE;
ALTER TABLE public.integration_property_mappings
    DROP CONSTRAINT integration_property_mappings_project_id_fkey,
    ADD CONSTRAINT integration_property_mappings_workspace_id_project_id_fkey FOREIGN KEY (workspace_id, project_id) REFERENCES public.projects(workspace_id, id) ON DELETE CASCADE;
ALTER TABLE public.integration_sync_runs
    DROP CONSTRAINT integration_sync_runs_project_id_fkey,
    ADD CONSTRAINT integration_sync_runs_workspace_id_project_id_fkey FOREIGN KEY (workspace_id, project_id) REFERENCES public.projects(workspace_id, id) ON DELETE CASCADE;
ALTER TABLE public.mcp_confirmations
    DROP CONSTRAINT mcp_confirmations_project_id_fkey,
    ADD CONSTRAINT mcp_confirmations_workspace_id_project_id_fkey FOREIGN KEY (workspace_id, project_id) REFERENCES public.projects(workspace_id, id) ON DELETE CASCADE;
ALTER TABLE public.metric_snapshots
    DROP CONSTRAINT metric_snapshots_project_id_fkey,
    ADD CONSTRAINT metric_snapshots_workspace_id_project_id_fkey FOREIGN KEY (workspace_id, project_id) REFERENCES public.projects(workspace_id, id) ON DELETE CASCADE;
ALTER TABLE public.monitored_site_urls
    DROP CONSTRAINT monitored_site_urls_project_id_fkey,
    ADD CONSTRAINT monitored_site_urls_workspace_id_project_id_fkey FOREIGN KEY (workspace_id, project_id) REFERENCES public.projects(workspace_id, id) ON DELETE CASCADE;
ALTER TABLE public.observed_entity_candidates
    DROP CONSTRAINT observed_entity_candidates_project_id_fkey,
    ADD CONSTRAINT observed_entity_candidates_workspace_id_project_id_fkey FOREIGN KEY (workspace_id, project_id) REFERENCES public.projects(workspace_id, id) ON DELETE CASCADE;
ALTER TABLE public.opportunities
    DROP CONSTRAINT opportunities_project_id_fkey,
    ADD CONSTRAINT opportunities_workspace_id_project_id_fkey FOREIGN KEY (workspace_id, project_id) REFERENCES public.projects(workspace_id, id) ON DELETE CASCADE;
ALTER TABLE public.opportunity_implementation_events
    DROP CONSTRAINT opportunity_implementation_events_project_id_fkey,
    ADD CONSTRAINT opportunity_implementation_events_workspace_id_project_id_fkey FOREIGN KEY (workspace_id, project_id) REFERENCES public.projects(workspace_id, id) ON DELETE CASCADE;
ALTER TABLE public.opportunity_orders
    DROP CONSTRAINT opportunity_orders_project_id_fkey,
    ADD CONSTRAINT opportunity_orders_workspace_id_project_id_fkey FOREIGN KEY (workspace_id, project_id) REFERENCES public.projects(workspace_id, id) ON DELETE CASCADE;
ALTER TABLE public.opportunity_snapshots
    DROP CONSTRAINT opportunity_snapshots_project_id_fkey,
    ADD CONSTRAINT opportunity_snapshots_workspace_id_project_id_fkey FOREIGN KEY (workspace_id, project_id) REFERENCES public.projects(workspace_id, id) ON DELETE CASCADE;
ALTER TABLE public.opportunity_verification_events
    DROP CONSTRAINT opportunity_verification_events_project_id_fkey,
    ADD CONSTRAINT opportunity_verification_events_workspace_id_project_id_fkey FOREIGN KEY (workspace_id, project_id) REFERENCES public.projects(workspace_id, id) ON DELETE CASCADE;
ALTER TABLE public.overview_layouts
    DROP CONSTRAINT overview_layouts_project_id_fkey,
    ADD CONSTRAINT overview_layouts_workspace_id_project_id_fkey FOREIGN KEY (workspace_id, project_id) REFERENCES public.projects(workspace_id, id) ON DELETE CASCADE;
ALTER TABLE public.performance_dimension_stats
    DROP CONSTRAINT performance_dimension_stats_project_id_fkey,
    ADD CONSTRAINT performance_dimension_stats_workspace_id_project_id_fkey FOREIGN KEY (workspace_id, project_id) REFERENCES public.projects(workspace_id, id) ON DELETE CASCADE;
ALTER TABLE public.prompt_metric_snapshots
    DROP CONSTRAINT prompt_metric_snapshots_project_id_fkey,
    ADD CONSTRAINT prompt_metric_snapshots_workspace_id_project_id_fkey FOREIGN KEY (workspace_id, project_id) REFERENCES public.projects(workspace_id, id) ON DELETE CASCADE;
ALTER TABLE public.query_evidence_rows
    DROP CONSTRAINT query_evidence_rows_project_id_fkey,
    ADD CONSTRAINT query_evidence_rows_workspace_id_project_id_fkey FOREIGN KEY (workspace_id, project_id) REFERENCES public.projects(workspace_id, id) ON DELETE CASCADE;
ALTER TABLE public.query_evidence_snapshots
    DROP CONSTRAINT query_evidence_snapshots_project_id_fkey,
    ADD CONSTRAINT query_evidence_snapshots_workspace_id_project_id_fkey FOREIGN KEY (workspace_id, project_id) REFERENCES public.projects(workspace_id, id) ON DELETE CASCADE;
ALTER TABLE public.referral_classifications
    DROP CONSTRAINT referral_classifications_project_id_fkey,
    ADD CONSTRAINT referral_classifications_workspace_id_project_id_fkey FOREIGN KEY (workspace_id, project_id) REFERENCES public.projects(workspace_id, id) ON DELETE CASCADE;
ALTER TABLE public.referral_events
    DROP CONSTRAINT referral_events_project_id_fkey,
    ADD CONSTRAINT referral_events_workspace_id_project_id_fkey FOREIGN KEY (workspace_id, project_id) REFERENCES public.projects(workspace_id, id) ON DELETE CASCADE;
ALTER TABLE public.search_intelligence_runs
    DROP CONSTRAINT search_intelligence_runs_project_id_fkey,
    ADD CONSTRAINT search_intelligence_runs_workspace_id_project_id_fkey FOREIGN KEY (workspace_id, project_id) REFERENCES public.projects(workspace_id, id) ON DELETE CASCADE;
ALTER TABLE public.site_change_snapshots
    DROP CONSTRAINT site_change_snapshots_project_id_fkey,
    ADD CONSTRAINT site_change_snapshots_workspace_id_project_id_fkey FOREIGN KEY (workspace_id, project_id) REFERENCES public.projects(workspace_id, id) ON DELETE CASCADE;
ALTER TABLE public.site_crawls
    DROP CONSTRAINT site_crawls_project_id_fkey,
    ADD CONSTRAINT site_crawls_workspace_id_project_id_fkey FOREIGN KEY (workspace_id, project_id) REFERENCES public.projects(workspace_id, id) ON DELETE CASCADE;
ALTER TABLE public.site_health_profiles
    DROP CONSTRAINT site_health_profiles_project_id_fkey,
    ADD CONSTRAINT site_health_profiles_workspace_id_project_id_fkey FOREIGN KEY (workspace_id, project_id) REFERENCES public.projects(workspace_id, id) ON DELETE CASCADE;
ALTER TABLE public.site_health_snapshots
    DROP CONSTRAINT site_health_snapshots_project_id_fkey,
    ADD CONSTRAINT site_health_snapshots_workspace_id_project_id_fkey FOREIGN KEY (workspace_id, project_id) REFERENCES public.projects(workspace_id, id) ON DELETE CASCADE;
ALTER TABLE public.site_issue_catalogs
    DROP CONSTRAINT site_issue_catalogs_project_id_fkey,
    ADD CONSTRAINT site_issue_catalogs_workspace_id_project_id_fkey FOREIGN KEY (workspace_id, project_id) REFERENCES public.projects(workspace_id, id) ON DELETE CASCADE;
ALTER TABLE public.site_issues
    DROP CONSTRAINT site_issues_project_id_fkey,
    ADD CONSTRAINT site_issues_workspace_id_project_id_fkey FOREIGN KEY (workspace_id, project_id) REFERENCES public.projects(workspace_id, id) ON DELETE CASCADE;
ALTER TABLE public.site_page_analyses
    DROP CONSTRAINT site_page_analyses_project_id_fkey,
    ADD CONSTRAINT site_page_analyses_workspace_id_project_id_fkey FOREIGN KEY (workspace_id, project_id) REFERENCES public.projects(workspace_id, id) ON DELETE CASCADE;
ALTER TABLE public.site_urls
    DROP CONSTRAINT site_urls_project_id_fkey,
    ADD CONSTRAINT site_urls_workspace_id_project_id_fkey FOREIGN KEY (workspace_id, project_id) REFERENCES public.projects(workspace_id, id) ON DELETE CASCADE;
ALTER TABLE public.source_page_entity_presences
    DROP CONSTRAINT source_page_entity_presences_project_id_fkey,
    ADD CONSTRAINT source_page_entity_presences_workspace_id_project_id_fkey FOREIGN KEY (workspace_id, project_id) REFERENCES public.projects(workspace_id, id) ON DELETE CASCADE;
ALTER TABLE public.source_page_inspection_spend
    DROP CONSTRAINT source_page_inspection_spend_project_id_fkey,
    ADD CONSTRAINT source_page_inspection_spend_workspace_id_project_id_fkey FOREIGN KEY (workspace_id, project_id) REFERENCES public.projects(workspace_id, id) ON DELETE CASCADE;
ALTER TABLE public.source_page_snapshots
    DROP CONSTRAINT source_page_snapshots_project_id_fkey,
    ADD CONSTRAINT source_page_snapshots_workspace_id_project_id_fkey FOREIGN KEY (workspace_id, project_id) REFERENCES public.projects(workspace_id, id) ON DELETE CASCADE;
ALTER TABLE public.traffic_page_stats
    DROP CONSTRAINT traffic_page_stats_project_id_fkey,
    ADD CONSTRAINT traffic_page_stats_workspace_id_project_id_fkey FOREIGN KEY (workspace_id, project_id) REFERENCES public.projects(workspace_id, id) ON DELETE CASCADE;
ALTER TABLE public.traffic_query_stats
    DROP CONSTRAINT traffic_query_stats_project_id_fkey,
    ADD CONSTRAINT traffic_query_stats_workspace_id_project_id_fkey FOREIGN KEY (workspace_id, project_id) REFERENCES public.projects(workspace_id, id) ON DELETE CASCADE;
ALTER TABLE public.traffic_snapshots
    DROP CONSTRAINT traffic_snapshots_project_id_fkey,
    ADD CONSTRAINT traffic_snapshots_workspace_id_project_id_fkey FOREIGN KEY (workspace_id, project_id) REFERENCES public.projects(workspace_id, id) ON DELETE CASCADE;
