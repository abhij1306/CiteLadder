-- Agent model choice and proposal outcomes, Site Health issues without a
-- finding class, evidence key limits, and composite references that keep
-- child rows inside their parent's scope. Forward-only; existing databases
-- upgrade in place.

-- 1. Each Agent chat records the model and reasoning effort it runs with.
--    Earlier chats take the defaults.
ALTER TABLE public.agent_chats
    ADD COLUMN model character varying(64) NOT NULL DEFAULT 'claude-haiku-5-5',
    ADD COLUMN reasoning_effort character varying(16) NOT NULL DEFAULT 'medium';
ALTER TABLE public.agent_chats
    ALTER COLUMN model DROP DEFAULT,
    ALTER COLUMN reasoning_effort DROP DEFAULT,
    ADD CONSTRAINT ck_agent_chats_reasoning_effort CHECK ((reasoning_effort IN ('low', 'medium', 'high'))),
    ADD CONSTRAINT uq_agent_chat_scope UNIQUE (workspace_id, project_id, id);

ALTER TABLE public.agent_messages
    ADD COLUMN views jsonb DEFAULT '[]'::jsonb NOT NULL,
    ADD CONSTRAINT uq_agent_message_chat UNIQUE (chat_id, id);

-- A message and a run belong to a chat in their own workspace and project.
ALTER TABLE public.agent_messages
    DROP CONSTRAINT agent_messages_chat_id_fkey,
    ADD CONSTRAINT agent_messages_chat_scope_fkey FOREIGN KEY (workspace_id, project_id, chat_id) REFERENCES public.agent_chats(workspace_id, project_id, id) ON DELETE CASCADE;
ALTER TABLE public.agent_runs
    DROP CONSTRAINT agent_runs_chat_id_fkey,
    DROP CONSTRAINT agent_runs_user_message_id_fkey,
    ADD CONSTRAINT agent_runs_chat_scope_fkey FOREIGN KEY (workspace_id, project_id, chat_id) REFERENCES public.agent_chats(workspace_id, project_id, id) ON DELETE CASCADE,
    ADD CONSTRAINT agent_runs_chat_message_fkey FOREIGN KEY (chat_id, user_message_id) REFERENCES public.agent_messages(chat_id, id) ON DELETE CASCADE;

-- 2. What happened to a change the Agent proposed. A decision (executed or
--    dismissed) is one row per proposal (message and index), written once, so
--    a card executes at most once. A live kind appends a claimed row, runs
--    its owner with no transaction open, and writes the decision after the
--    owner succeeds; a failed run appends a released row, and a refused
--    confirm leaves the card open and appends a refused row with the reason,
--    which the Agent's next turn reads. The proposal itself stays in
--    agent_messages.proposals.
CREATE TABLE public.agent_proposal_outcomes (
    id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    project_id uuid NOT NULL,
    chat_id uuid NOT NULL,
    message_id uuid NOT NULL,
    proposal_index integer NOT NULL,
    state character varying(16) NOT NULL,
    reason character varying(500),
    user_id uuid,
    created_at timestamp with time zone NOT NULL,
    CONSTRAINT ck_agent_proposal_outcome_state CHECK (state IN ('executed', 'dismissed', 'refused', 'claimed', 'released')),
    CONSTRAINT ck_agent_proposal_outcome_reason CHECK ((state = 'refused') = (reason IS NOT NULL)),
    CONSTRAINT ck_agent_proposal_outcome_index CHECK (proposal_index >= 0)
);
ALTER TABLE ONLY public.agent_proposal_outcomes
    ADD CONSTRAINT agent_proposal_outcomes_pkey PRIMARY KEY (id);
CREATE UNIQUE INDEX uq_agent_proposal_outcome ON public.agent_proposal_outcomes USING btree (message_id, proposal_index) WHERE ((state)::text IN ('executed', 'dismissed'));
CREATE INDEX ix_agent_proposal_outcomes_chat_id ON public.agent_proposal_outcomes USING btree (chat_id, created_at);
CREATE INDEX ix_agent_proposal_outcomes_project_id ON public.agent_proposal_outcomes USING btree (workspace_id, project_id);
CREATE INDEX ix_agent_proposal_outcomes_user_id ON public.agent_proposal_outcomes USING btree (user_id) WHERE (user_id IS NOT NULL);
ALTER TABLE ONLY public.agent_proposal_outcomes
    ADD CONSTRAINT agent_proposal_outcomes_chat_id_fkey FOREIGN KEY (chat_id) REFERENCES public.agent_chats(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.agent_proposal_outcomes
    ADD CONSTRAINT agent_proposal_outcomes_message_id_fkey FOREIGN KEY (message_id) REFERENCES public.agent_messages(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.agent_proposal_outcomes
    ADD CONSTRAINT agent_proposal_outcomes_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.agent_proposal_outcomes
    ADD CONSTRAINT agent_proposal_outcomes_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.agent_proposal_outcomes
    ADD CONSTRAINT agent_proposal_outcomes_workspace_id_project_id_fkey FOREIGN KEY (workspace_id, project_id) REFERENCES public.projects(workspace_id, id) ON DELETE CASCADE;

-- Rule guidance is read as a strict object; a NULL comparison no longer
-- passes the check.
ALTER TABLE public.agent_output_suggestions
    DROP CONSTRAINT ck_agent_output_suggestions_rule_guidance,
    ADD CONSTRAINT ck_agent_output_suggestions_rule_guidance CHECK (((rule_guidance IS NULL) OR ((jsonb_typeof(rule_guidance) = 'object'::text) AND (((rule_guidance ->> 'strength'::text) = ANY (ARRAY['requirement'::text, 'recommendation'::text, 'heuristic'::text])) IS TRUE) AND ((jsonb_typeof((rule_guidance -> 'source_url'::text)) = 'string'::text) IS TRUE) AND ((jsonb_typeof((rule_guidance -> 'catalog_version'::text)) = 'string'::text) IS TRUE))));

-- 3. MCP is read-only: the confirmation table of the write tools is gone.
DROP TABLE public.mcp_confirmations;

-- 4. Audit tasks reference a snapshot of their own audit.
ALTER TABLE public.audit_engine_snapshots
    ADD CONSTRAINT uq_audit_engine_snapshot_audit UNIQUE (audit_id, id);
ALTER TABLE public.audit_prompt_snapshots
    ADD CONSTRAINT uq_audit_prompt_snapshot_audit UNIQUE (audit_id, id);
ALTER TABLE public.audit_tasks
    DROP CONSTRAINT audit_tasks_engine_snapshot_id_fkey,
    DROP CONSTRAINT audit_tasks_prompt_snapshot_id_fkey,
    ADD CONSTRAINT audit_tasks_audit_engine_snapshot_fkey FOREIGN KEY (audit_id, engine_snapshot_id) REFERENCES public.audit_engine_snapshots(audit_id, id) ON DELETE CASCADE,
    ADD CONSTRAINT audit_tasks_audit_prompt_snapshot_fkey FOREIGN KEY (audit_id, prompt_snapshot_id) REFERENCES public.audit_prompt_snapshots(audit_id, id) ON DELETE CASCADE;

CREATE INDEX ix_answer_perceptions_workspace_id_project_id ON public.answer_perceptions USING btree (workspace_id, project_id);

-- 5. Site Health issues no longer carry a finding class: every issue is a
--    defect, and the advisory class is retired. Earlier advisory and
--    diagnostic rows are dropped with the column.
DELETE FROM public.site_issue_catalogs WHERE finding_class <> 'defect';
ALTER TABLE public.site_issue_catalogs
    DROP CONSTRAINT site_issue_catalogs_pkey,
    DROP COLUMN finding_class,
    ADD CONSTRAINT site_issue_catalogs_pkey PRIMARY KEY (crawl_id);
DELETE FROM public.site_issues WHERE finding_class <> 'defect';
DROP INDEX public.ix_site_issues_current;
DROP INDEX public.ix_site_issues_filter;
ALTER TABLE public.site_issues DROP COLUMN finding_class;
CREATE INDEX ix_site_issues_current ON public.site_issues USING btree (crawl_id) WHERE is_current;
CREATE INDEX ix_site_issues_filter ON public.site_issues USING btree (crawl_id, severity, category, rule_id);

-- 6. Brand research keeps its fields and warnings, not a raw evidence blob.
ALTER TABLE public.brand_discoveries DROP COLUMN evidence;
ALTER TABLE public.brand_research_snapshots DROP COLUMN evidence;

-- 7. A theme may come from the model.
ALTER TABLE public.project_themes
    DROP CONSTRAINT ck_project_themes_source,
    ADD CONSTRAINT ck_project_themes_source CHECK ((source IN ('research', 'user', 'model')));

-- 8. Key limits. A value used in a unique key stays within 2048 bytes so the
--    index entry can never overflow the btree page limit.
ALTER TABLE public.integration_metric_rows ALTER COLUMN dimension_key TYPE character varying(2048);
ALTER TABLE public.traffic_query_stats ALTER COLUMN normalized_query TYPE character varying(2048);

ALTER TABLE public.aio_entity_links
    ADD CONSTRAINT ck_aio_entity_links_url_key_bytes CHECK ((octet_length((url)::text) <= 2048));
ALTER TABLE public.performance_dimension_stats
    ADD CONSTRAINT ck_performance_dimension_stats_dimension_key_key_bytes CHECK ((octet_length((dimension_key)::text) <= 2048));
ALTER TABLE public.search_intelligence_rows
    ADD CONSTRAINT ck_search_intelligence_rows_keyword_key_bytes CHECK ((octet_length((keyword)::text) <= 2048)),
    ADD CONSTRAINT ck_search_intelligence_rows_url_key_bytes CHECK ((octet_length((url)::text) <= 2048));
ALTER TABLE public.commerce_competitor_candidates
    ADD CONSTRAINT ck_commerce_competitor_candidates_canonical_url_key_bytes CHECK ((octet_length((canonical_url)::text) <= 2048));
ALTER TABLE public.commerce_products
    ADD CONSTRAINT ck_commerce_products_canonical_url_key_bytes CHECK ((octet_length((canonical_url)::text) <= 2048));
ALTER TABLE public.site_urls
    ADD CONSTRAINT ck_site_urls_normalized_url_key_bytes CHECK ((octet_length((normalized_url)::text) <= 2048));
ALTER TABLE public.traffic_page_stats
    ADD CONSTRAINT ck_traffic_page_stats_canonical_url_key_bytes CHECK ((octet_length((canonical_url)::text) <= 2048));
ALTER TABLE public.traffic_query_stats
    ADD CONSTRAINT ck_traffic_query_stats_normalized_query_key_bytes CHECK ((octet_length((normalized_query)::text) <= 2048));
ALTER TABLE public.integration_metric_rows
    ADD CONSTRAINT ck_integration_metric_rows_identity_key_bytes CHECK (((octet_length((property_ref)::text) + octet_length((dimension_key)::text)) <= 2048));
