-- CiteLadder schema baseline. `src/cli/migrate.ts` applies each file in this
-- directory once, in version order, and records its SHA-256 in
-- schema_migrations. Applied files are frozen: change the schema with a new
-- numbered file (0002_*.sql, ...), never by editing this one.

CREATE TABLE public.schema_migrations (
    version character varying(64) NOT NULL,
    checksum character(64) NOT NULL,
    applied_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT schema_migrations_pkey PRIMARY KEY (version)
);

CREATE TABLE public.account_grants (
    id uuid NOT NULL,
    billing_account_id uuid NOT NULL,
    source_kind character varying(16) NOT NULL,
    source_ref character varying(255) NOT NULL,
    bundle_role character varying(16) DEFAULT 'supplement'::character varying NOT NULL,
    profile_key character varying(64) DEFAULT ''::character varying NOT NULL,
    profile_priority integer DEFAULT 0 NOT NULL,
    bundle_id character varying(255) DEFAULT ''::character varying NOT NULL,
    key character varying(64) NOT NULL,
    value integer NOT NULL,
    period_start timestamp with time zone,
    period_end timestamp with time zone,
    valid_from timestamp with time zone NOT NULL,
    valid_until timestamp with time zone,
    catalog_revision character varying(64) NOT NULL,
    idempotency_key character varying(255) NOT NULL,
    created_at timestamp with time zone NOT NULL,
    CONSTRAINT ck_account_grant_bundle_role CHECK (((bundle_role)::text = ANY ((ARRAY['primary'::character varying, 'supplement'::character varying])::text[]))),
    CONSTRAINT ck_account_grant_period_ordered CHECK (((period_start IS NULL) OR (period_end IS NULL) OR (period_start < period_end))),
    CONSTRAINT ck_account_grant_primary_bundle_identity CHECK ((((bundle_role)::text <> 'primary'::text) OR ((bundle_id)::text <> ''::text))),
    CONSTRAINT ck_account_grant_valid_ordered CHECK (((valid_until IS NULL) OR (valid_until > valid_from))),
    CONSTRAINT ck_account_grant_value_nonneg CHECK ((value >= 0))
);

CREATE TABLE public.account_policy_acceptances (
    id uuid NOT NULL,
    actor_id uuid NOT NULL,
    terms_revision character varying(64) NOT NULL,
    privacy_notice_revision character varying(64) NOT NULL,
    context character varying(32) NOT NULL,
    accepted_at timestamp with time zone NOT NULL
);

CREATE TABLE public.action_status_events (
    id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    project_id uuid NOT NULL,
    action_id uuid NOT NULL,
    previous_status character varying(16) NOT NULL,
    next_status character varying(16) NOT NULL,
    changed_by_user_id uuid NOT NULL,
    created_at timestamp with time zone NOT NULL
);

CREATE TABLE public.actions (
    id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    project_id uuid NOT NULL,
    group_key character varying(640) NOT NULL,
    target_kind character varying(24) NOT NULL,
    target_label character varying(255) NOT NULL,
    target_url text,
    target_prompt_id uuid,
    origin character varying(16) NOT NULL,
    status character varying(16) NOT NULL,
    priority_score double precision,
    families jsonb NOT NULL,
    approach character varying(32) NOT NULL,
    skill_id character varying(64) NOT NULL,
    diagnosis jsonb NOT NULL,
    member_opportunity_ids jsonb NOT NULL,
    opportunity_snapshot_id uuid,
    evidence_cleared_at timestamp with time zone,
    created_by_user_id uuid,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL
);

CREATE TABLE public.agent_chats (
    id uuid NOT NULL,
    action_id uuid,
    created_by_user_id uuid,
    title character varying(120) NOT NULL,
    context_refs jsonb NOT NULL,
    pinned_skill_id character varying(64),
    turn_count integer NOT NULL,
    last_activity_at timestamp with time zone NOT NULL,
    archived_at timestamp with time zone,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    workspace_id uuid NOT NULL,
    project_id uuid NOT NULL
);

CREATE TABLE public.agent_instruction_revisions (
    id uuid NOT NULL,
    revision integer NOT NULL,
    text text NOT NULL,
    created_by_user_id uuid,
    created_at timestamp with time zone NOT NULL,
    workspace_id uuid NOT NULL,
    project_id uuid NOT NULL
);

CREATE TABLE public.agent_messages (
    id uuid NOT NULL,
    chat_id uuid NOT NULL,
    sequence integer NOT NULL,
    role character varying(16) NOT NULL,
    content text NOT NULL,
    reply_to_message_id uuid,
    author_user_id uuid,
    skill_id character varying(64),
    skill_source character varying(16),
    evidence_refs jsonb NOT NULL,
    steps jsonb NOT NULL,
    mentions jsonb NOT NULL,
    created_at timestamp with time zone NOT NULL,
    workspace_id uuid NOT NULL,
    project_id uuid NOT NULL
);

CREATE TABLE public.agent_model_attempts (
    id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    project_id uuid NOT NULL,
    run_id uuid NOT NULL,
    dispatch_id uuid NOT NULL,
    run_attempt integer NOT NULL,
    ordinal integer NOT NULL,
    funding_source character varying(24) NOT NULL,
    provider_adapter character varying(64) NOT NULL,
    endpoint_host character varying(255) NOT NULL,
    requested_model character varying(255) NOT NULL,
    returned_model character varying(255) NOT NULL,
    pricing_revision character varying(64) NOT NULL,
    reservation_id uuid,
    reserved_credits bigint NOT NULL,
    debited_credits bigint NOT NULL,
    input_tokens bigint,
    cached_input_tokens bigint,
    cache_write_input_tokens bigint,
    output_tokens bigint,
    reasoning_tokens bigint,
    total_tokens bigint,
    usage_complete boolean NOT NULL,
    settlement_status character varying(24) NOT NULL,
    request_hash character varying(64) NOT NULL,
    output_hash character varying(64) NOT NULL,
    outcome character varying(24) NOT NULL,
    finish_status character varying(64) NOT NULL,
    error_code character varying(64) NOT NULL,
    latency_ms integer,
    dispatched_at timestamp with time zone NOT NULL,
    deadline_at timestamp with time zone NOT NULL,
    settled_at timestamp with time zone,
    late_receipt boolean NOT NULL,
    created_at timestamp with time zone NOT NULL
);

CREATE TABLE public.agent_output_revisions (
    id uuid NOT NULL,
    output_id uuid NOT NULL,
    number integer NOT NULL,
    parent_revision_id uuid,
    author character varying(16) NOT NULL,
    author_user_id uuid,
    run_id uuid,
    message_id uuid,
    phase character varying(16) NOT NULL,
    title character varying(255) NOT NULL,
    body text NOT NULL,
    source_refs jsonb NOT NULL,
    approved_at timestamp with time zone,
    approved_by_user_id uuid,
    created_at timestamp with time zone NOT NULL,
    workspace_id uuid NOT NULL,
    project_id uuid NOT NULL
);

CREATE TABLE public.agent_outputs (
    id uuid NOT NULL,
    chat_id uuid NOT NULL,
    action_id uuid,
    kind character varying(32) NOT NULL,
    skill_id character varying(64) NOT NULL,
    format_id character varying(32),
    target_kind character varying(24),
    target_label character varying(255),
    phase character varying(16) NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    workspace_id uuid NOT NULL,
    project_id uuid NOT NULL
);

CREATE TABLE public.agent_runs (
    id uuid NOT NULL,
    chat_id uuid NOT NULL,
    user_message_id uuid NOT NULL,
    user_id uuid,
    idempotency_key character varying(128) NOT NULL,
    request_fingerprint character varying(64) NOT NULL,
    mode character varying(24) NOT NULL,
    requested_skill_id character varying(64),
    requested_skill_source character varying(16),
    context_manifest jsonb NOT NULL,
    budget jsonb NOT NULL,
    runtime_version character varying(32) NOT NULL,
    protocol_version character varying(32) NOT NULL,
    registry_version character varying(32) NOT NULL,
    skill_catalog_version character varying(32) NOT NULL,
    funding_source character varying(24) NOT NULL,
    requested_model character varying(255) NOT NULL,
    max_attempts integer NOT NULL,
    skill_id character varying(64),
    skill_source character varying(16),
    skill_version integer,
    steps_used integer NOT NULL,
    cancelled_at timestamp with time zone,
    workspace_id uuid NOT NULL,
    project_id uuid NOT NULL,
    status character varying(24) NOT NULL,
    priority integer NOT NULL,
    randomized_position integer NOT NULL,
    available_at timestamp with time zone NOT NULL,
    lease_owner character varying(64),
    lease_expires_at timestamp with time zone,
    heartbeat_at timestamp with time zone,
    attempt_count integer NOT NULL,
    error_code character varying(32) NOT NULL,
    error_detail text NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    completed_at timestamp with time zone
);

CREATE TABLE public.agent_run_transcripts (
    id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    project_id uuid NOT NULL,
    run_id uuid NOT NULL,
    chat_id uuid NOT NULL,
    provider_adapter character varying(64) NOT NULL,
    model character varying(255) NOT NULL,
    skill_id character varying(64),
    context_hash character varying(64) NOT NULL,
    messages jsonb NOT NULL,
    created_at timestamp with time zone NOT NULL
);

CREATE TABLE public.agent_tool_attempts (
    id uuid NOT NULL,
    run_id uuid NOT NULL,
    run_attempt integer NOT NULL,
    ordinal integer NOT NULL,
    call_id character varying(64) NOT NULL,
    tool_name character varying(128) NOT NULL,
    registry_version character varying(32) NOT NULL,
    status character varying(16) NOT NULL,
    input jsonb NOT NULL,
    artifact_refs jsonb NOT NULL,
    output_hash character varying(64) NOT NULL,
    omissions jsonb NOT NULL,
    error_code character varying(64) NOT NULL,
    latency_ms integer NOT NULL,
    created_at timestamp with time zone NOT NULL,
    workspace_id uuid NOT NULL,
    project_id uuid NOT NULL
);

CREATE TABLE public.ai_referral_landing_daily (
    id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    project_id uuid NOT NULL,
    reporting_date date NOT NULL,
    reporting_timezone character varying(128) NOT NULL,
    url_hash character varying(64) NOT NULL,
    canonical_url character varying(4096) NOT NULL,
    display_path character varying(2048) NOT NULL,
    folder character varying(2048) NOT NULL,
    resource_class character varying(24) NOT NULL,
    ai_source character varying(64) NOT NULL,
    sessions integer NOT NULL,
    engaged_sessions integer NOT NULL,
    key_events double precision NOT NULL,
    analytics_quality jsonb NOT NULL,
    source_metric_row_ids jsonb NOT NULL,
    formula_version character varying(64) NOT NULL
);

CREATE TABLE public.ai_referrals_snapshots (
    id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    project_id uuid NOT NULL,
    window_start date NOT NULL,
    window_end date NOT NULL,
    granularity character varying(8) NOT NULL,
    preset_window_days integer,
    metrics jsonb,
    source_classification_ids jsonb,
    analyzer_version character varying(64) NOT NULL,
    formula_version character varying(64) NOT NULL,
    created_at timestamp with time zone NOT NULL
);

CREATE TABLE public.ai_traffic_insights (
    id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    project_id uuid NOT NULL,
    window_start date NOT NULL,
    window_end date NOT NULL,
    formula_version character varying(64) NOT NULL,
    thresholds jsonb NOT NULL,
    patterns jsonb NOT NULL,
    coverage jsonb NOT NULL,
    provenance jsonb NOT NULL,
    created_at timestamp with time zone NOT NULL
);

CREATE TABLE public.aio_entity_links (
    id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    observation_id uuid NOT NULL,
    url text NOT NULL,
    domain character varying(255) DEFAULT ''::character varying NOT NULL,
    title text DEFAULT ''::text NOT NULL,
    element_index integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone NOT NULL
);

CREATE TABLE public.aio_observations (
    id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    audit_id uuid NOT NULL,
    task_id uuid NOT NULL,
    outcome character varying(32) NOT NULL,
    error_code character varying(64) DEFAULT ''::character varying NOT NULL,
    provider_status_code integer,
    aio_present boolean,
    aio_serp_position integer,
    location_code integer NOT NULL,
    language_code character varying(8) NOT NULL,
    device character varying(16) NOT NULL,
    provider_task_id character varying(64) DEFAULT ''::character varying NOT NULL,
    provider_submission_ref character varying(255) DEFAULT ''::character varying NOT NULL,
    provider_connection_id uuid,
    element_count integer DEFAULT 0 NOT NULL,
    reference_count integer DEFAULT 0 NOT NULL,
    observed_at timestamp with time zone,
    retrieved_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone NOT NULL
);

CREATE TABLE public.analytics_tasks (
    id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    project_id uuid,
    task_kind character varying(32) NOT NULL,
    payload jsonb,
    idempotency_key character varying(160) NOT NULL,
    status character varying(24) NOT NULL,
    priority integer NOT NULL,
    randomized_position integer NOT NULL,
    available_at timestamp with time zone NOT NULL,
    lease_owner character varying(64),
    lease_expires_at timestamp with time zone,
    heartbeat_at timestamp with time zone,
    attempt_count integer NOT NULL,
    max_attempts integer NOT NULL,
    error_code character varying(32) NOT NULL,
    error_detail text NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    completed_at timestamp with time zone
);

CREATE TABLE public.answer_ad_observations (
    id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    project_id uuid NOT NULL,
    audit_id uuid NOT NULL,
    task_id uuid NOT NULL,
    artifact_id uuid NOT NULL,
    parser_version character varying(32) NOT NULL,
    rank_absolute integer NOT NULL,
    rank_group integer,
    advertiser_name character varying(255) NOT NULL,
    advertiser_domain character varying(255) NOT NULL,
    landing_url_raw text NOT NULL,
    landing_url_canonical text NOT NULL,
    title text NOT NULL,
    snippet text NOT NULL,
    image_url text,
    ownership character varying(16) NOT NULL,
    competitor_id uuid,
    created_at timestamp with time zone NOT NULL,
    CONSTRAINT ck_answer_ad_observation_ownership CHECK (((ownership)::text = ANY ((ARRAY['owned'::character varying, 'competitor'::character varying, 'other'::character varying])::text[])))
);

CREATE TABLE public.answer_perceptions (
    id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    project_id uuid NOT NULL,
    audit_id uuid NOT NULL,
    task_id uuid NOT NULL,
    analysis_id uuid NOT NULL,
    artifact_id uuid NOT NULL,
    extractor_version character varying(64) NOT NULL,
    template_version character varying(64) NOT NULL,
    model_provider character varying(32),
    model character varying(255),
    input_hash character varying(64),
    outcome character varying(32) NOT NULL,
    outcome_reason character varying(64),
    drop_counts jsonb DEFAULT '{}'::jsonb NOT NULL,
    usage jsonb,
    latency_ms integer,
    created_at timestamp with time zone NOT NULL,
    CONSTRAINT ck_answer_perception_outcome CHECK (((outcome)::text = ANY ((ARRAY['classified'::character varying, 'no_mentions'::character varying, 'unavailable'::character varying, 'invalid_output'::character varying, 'model_error'::character varying])::text[])))
);

CREATE TABLE public.answer_claims (
    id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    perception_id uuid NOT NULL,
    ordinal integer NOT NULL,
    topic character varying(32) NOT NULL,
    claim text NOT NULL,
    quote text NOT NULL,
    quote_start integer NOT NULL,
    quote_end integer NOT NULL,
    confidence double precision NOT NULL,
    low_confidence boolean NOT NULL
);

CREATE TABLE public.api_idempotency (
    id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    api_key_id uuid NOT NULL,
    idempotency_key character varying(255) NOT NULL,
    request_hash character varying(64) NOT NULL,
    status_code integer,
    response_body jsonb,
    created_at timestamp with time zone NOT NULL
);

CREATE TABLE public.api_keys (
    id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    name character varying(80) NOT NULL,
    prefix character varying(16) NOT NULL,
    secret_hmac bytea NOT NULL,
    scopes text[] NOT NULL,
    project_ids uuid[],
    created_by_user_id uuid NOT NULL,
    created_at timestamp with time zone NOT NULL,
    expires_at timestamp with time zone,
    last_used_at timestamp with time zone,
    rejection_logged_at timestamp with time zone,
    revoked_at timestamp with time zone,
    revoke_reason character varying(32),
    CONSTRAINT ck_api_keys_revocation CHECK (((revoked_at IS NULL) = (revoke_reason IS NULL)))
);

CREATE TABLE public.audit_engine_snapshots (
    id uuid NOT NULL,
    audit_id uuid NOT NULL,
    logical_engine character varying(32) NOT NULL,
    transport_provider character varying(32) NOT NULL,
    transport_model character varying(255) NOT NULL,
    connection_id uuid,
    base_url character varying(1024) NOT NULL,
    created_at timestamp with time zone NOT NULL
);

CREATE TABLE public.audit_events (
    id uuid NOT NULL,
    audit_id uuid NOT NULL,
    event_type character varying(48) NOT NULL,
    message text NOT NULL,
    payload jsonb,
    created_at timestamp with time zone NOT NULL
);

CREATE TABLE public.audit_prompt_snapshots (
    id uuid NOT NULL,
    audit_id uuid NOT NULL,
    prompt_id uuid,
    prompt_index integer NOT NULL,
    text text NOT NULL,
    theme character varying(255) NOT NULL,
    intent character varying(32) NOT NULL,
    buyer_stage character varying(32) NOT NULL,
    prompt_intent character varying(32) NOT NULL,
    cohort character varying(32) DEFAULT 'core'::character varying NOT NULL,
    generation_evidence jsonb,
    created_at timestamp with time zone NOT NULL
);

CREATE TABLE public.audit_schedules (
    id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    project_id uuid NOT NULL,
    prompt_set_id uuid NOT NULL,
    audit_scope character varying(16) NOT NULL,
    cadence character varying(32) NOT NULL,
    interval_minutes integer,
    timezone character varying(64) NOT NULL,
    engines jsonb NOT NULL,
    market_ids jsonb DEFAULT '[null]'::jsonb NOT NULL,
    repetitions integer,
    benchmark_mode character varying(32),
    enabled boolean NOT NULL,
    next_run_at timestamp with time zone,
    last_run_at timestamp with time zone,
    failure_count integer NOT NULL,
    last_error character varying(255) NOT NULL,
    last_failure_at timestamp with time zone,
    lease_owner character varying(64),
    lease_expires_at timestamp with time zone,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL
);

CREATE TABLE public.audit_tasks (
    id uuid NOT NULL,
    audit_id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    project_id uuid NOT NULL,
    prompt_snapshot_id uuid NOT NULL,
    engine_snapshot_id uuid NOT NULL,
    prompt_index integer NOT NULL,
    repetition integer NOT NULL,
    randomized_position integer NOT NULL,
    logical_engine character varying(32) NOT NULL,
    transport_provider character varying(32) NOT NULL,
    transport_model character varying(255) NOT NULL,
    prompt_text text NOT NULL,
    provider_route_snapshot jsonb,
    idempotency_key character varying(128) NOT NULL,
    status character varying(24) NOT NULL,
    priority integer NOT NULL,
    available_at timestamp with time zone NOT NULL,
    lease_owner character varying(64),
    lease_expires_at timestamp with time zone,
    heartbeat_at timestamp with time zone,
    attempt_count integer NOT NULL,
    max_attempts integer NOT NULL,
    provider_submission_ref character varying(255) DEFAULT ''::character varying NOT NULL,
    provider_task_id character varying(64) DEFAULT ''::character varying NOT NULL,
    provider_task_submitted_at timestamp with time zone,
    provider_connection_id uuid,
    provider_credential_revision uuid,
    provider_poll_count integer DEFAULT 0 NOT NULL,
    result_artifact_id uuid,
    source_task_id uuid,
    answer_text text NOT NULL,
    search_used boolean NOT NULL,
    search_events jsonb,
    citations jsonb,
    score jsonb,
    request_snapshot jsonb,
    provider_metadata jsonb,
    latency_ms integer,
    finish_reason character varying(24) NOT NULL,
    raw_finish_reason character varying(64),
    error_code character varying(32) NOT NULL,
    error_detail text NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    completed_at timestamp with time zone
);

CREATE TABLE public.audits (
    id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    project_id uuid NOT NULL,
    status character varying(32) NOT NULL,
    trigger character varying(16) NOT NULL,
    benchmark_mode character varying(32) NOT NULL,
    audit_scope character varying(16) DEFAULT 'brand'::character varying NOT NULL,
    parent_audit_id uuid,
    repair_key character varying(64),
    schedule_id uuid,
    scheduled_for timestamp with time zone,
    funding_account_id uuid,
    funded_budget_period_start timestamp with time zone,
    system_instruction text NOT NULL,
    repetitions integer NOT NULL,
    random_seed character varying(32) NOT NULL,
    configuration jsonb,
    summary jsonb,
    analyzer_version character varying(32) NOT NULL,
    requested_count integer NOT NULL,
    completed_count integer NOT NULL,
    failed_count integer NOT NULL,
    error_message text NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    started_at timestamp with time zone,
    completed_at timestamp with time zone,
    market_id uuid,
    launch_id uuid
);

CREATE TABLE public.auth_challenges (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    email character varying(255) NOT NULL,
    purpose character varying(24) NOT NULL,
    token_digest character varying(64) NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone NOT NULL,
    consumed_at timestamp with time zone
);

CREATE TABLE public.billing_accounts (
    id uuid NOT NULL,
    registration_origin character varying(24) NOT NULL,
    workspace_id uuid NOT NULL,
    owner_user_id uuid,
    status character varying(24) NOT NULL,
    billing_country character varying(2) NOT NULL,
    country_verification character varying(16) NOT NULL,
    billing_profile jsonb,
    entitlement_lifecycle_version integer DEFAULT 0 NOT NULL,
    registration_cohort_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    CONSTRAINT ck_billing_account_entitlement_version_nonneg CHECK ((entitlement_lifecycle_version >= 0)),
    CONSTRAINT ck_billing_account_registration_origin CHECK (((registration_origin)::text = ANY ((ARRAY['public'::character varying, 'operator'::character varying])::text[])))
);

CREATE TABLE public.billing_catalog_revisions (
    id uuid NOT NULL,
    revision character varying(64) NOT NULL,
    payload jsonb NOT NULL,
    payload_sha256 character varying(64) NOT NULL,
    publication_state character varying(16) NOT NULL,
    created_by_user_id uuid NOT NULL,
    created_reason character varying(255) NOT NULL,
    created_idempotency_key character varying(255),
    created_at timestamp with time zone NOT NULL,
    published_by_user_id uuid,
    published_reason character varying(255),
    published_idempotency_key character varying(255),
    published_at timestamp with time zone
);

CREATE TABLE public.billing_invoice_counters (
    financial_year character varying(16) NOT NULL,
    next_value integer NOT NULL,
    CONSTRAINT ck_billing_invoice_counter_positive CHECK ((next_value > 0))
);

CREATE TABLE public.billing_invoices (
    id uuid NOT NULL,
    billing_account_id uuid NOT NULL,
    payment_id uuid NOT NULL,
    invoice_number character varying(40) NOT NULL,
    receipt_number character varying(40) NOT NULL,
    financial_year character varying(7) NOT NULL,
    document_kind character varying(24) NOT NULL,
    invoice_date date NOT NULL,
    paid_at timestamp with time zone NOT NULL,
    currency character varying(3) NOT NULL,
    total_amount_minor integer NOT NULL,
    tax_treatment character varying(24) NOT NULL,
    tax_policy_version integer NOT NULL,
    payload jsonb NOT NULL,
    payload_sha256 character varying(64) NOT NULL,
    created_at timestamp with time zone NOT NULL,
    CONSTRAINT ck_billing_invoice_policy_v1 CHECK ((tax_policy_version = 1)),
    CONSTRAINT ck_billing_invoice_total_nonneg CHECK ((total_amount_minor >= 0))
);

CREATE TABLE public.billing_payments (
    id uuid NOT NULL,
    billing_account_id uuid NOT NULL,
    pending_activation_id uuid,
    subscription_id uuid,
    parent_payment_id uuid,
    provider character varying(24) NOT NULL,
    receipt_kind character varying(16) NOT NULL,
    external_payment_id character varying(255) NOT NULL,
    external_order_id character varying(255),
    external_invoice_id character varying(255),
    external_refund_id character varying(255),
    amount_minor integer NOT NULL,
    currency character varying(3) NOT NULL,
    provider_mode character varying(8) NOT NULL,
    payment_method character varying(24) NOT NULL,
    status character varying(24) NOT NULL,
    paid_at timestamp with time zone,
    period_start timestamp with time zone,
    period_end timestamp with time zone,
    receipt_sha256 character varying(64) NOT NULL,
    created_at timestamp with time zone NOT NULL,
    CONSTRAINT ck_billing_payment_amount_nonneg CHECK ((amount_minor >= 0))
);

CREATE TABLE public.billing_subscriptions (
    id uuid NOT NULL,
    billing_account_id uuid NOT NULL,
    provider character varying(24) NOT NULL,
    provider_mode character varying(8) NOT NULL,
    external_subscription_id character varying(255) NOT NULL,
    external_price_id character varying(255) NOT NULL,
    catalog_revision character varying(64) NOT NULL,
    catalog_key character varying(64) NOT NULL,
    subscription_kind character varying(16) NOT NULL,
    cadence character varying(24) NOT NULL,
    credential_mode character varying(16) NOT NULL,
    frozen_terms jsonb NOT NULL,
    scheduled_change jsonb,
    quantity integer DEFAULT 1 NOT NULL,
    currency character varying(3) NOT NULL,
    status character varying(24) NOT NULL,
    current_period_start timestamp with time zone,
    current_period_end timestamp with time zone,
    cancel_at_period_end boolean NOT NULL,
    cancellation_sent_at timestamp with time zone,
    ended_at timestamp with time zone,
    provider_state_version integer NOT NULL,
    is_current boolean NOT NULL,
    reconciliation_next_at timestamp with time zone,
    reconciliation_lease_token uuid,
    reconciliation_lease_expires_at timestamp with time zone,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL
);

CREATE TABLE public.billing_webhook_events (
    id uuid NOT NULL,
    provider character varying(24) NOT NULL,
    provider_mode character varying(8) NOT NULL,
    external_event_id character varying(255) NOT NULL,
    event_type character varying(128) NOT NULL,
    payload_sha256 character varying(64) NOT NULL,
    safe_summary jsonb,
    received_at timestamp with time zone NOT NULL,
    processed_at timestamp with time zone,
    result_code character varying(64) NOT NULL,
    error_code character varying(64) NOT NULL,
    processing_state character varying(16) NOT NULL,
    attempt_count integer DEFAULT 0 NOT NULL,
    next_attempt_at timestamp with time zone,
    lease_token uuid,
    lease_expires_at timestamp with time zone
);

CREATE TABLE public.bot_activity_daily (
    id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    project_id uuid NOT NULL,
    reporting_date date NOT NULL,
    reporting_timezone character varying(64) NOT NULL,
    bot_id character varying(64) NOT NULL,
    identity_key character varying(64) NOT NULL,
    identity character varying(24) NOT NULL,
    url_hash character varying(64),
    display_path character varying(2048) NOT NULL,
    canonical_url character varying(4096),
    folder character varying(2048) NOT NULL,
    resource_class character varying(24) NOT NULL,
    verification character varying(24) NOT NULL,
    status_code integer NOT NULL,
    requests integer NOT NULL,
    first_seen_at timestamp with time zone NOT NULL,
    last_seen_at timestamp with time zone NOT NULL,
    formula_version character varying(32) NOT NULL,
    source_batch_ids jsonb NOT NULL,
    verification_reasons jsonb NOT NULL
);

CREATE TABLE public.bot_ip_range_snapshots (
    id uuid NOT NULL,
    bot_id character varying(64) NOT NULL,
    source_url character varying(1024) NOT NULL,
    fetched_at timestamp with time zone NOT NULL,
    content_hash character varying(64) NOT NULL,
    cidrs jsonb NOT NULL,
    status character varying(24) NOT NULL
);

CREATE TABLE public.bot_requests (
    id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    project_id uuid NOT NULL,
    source_id uuid NOT NULL,
    batch_id uuid NOT NULL,
    occurred_at timestamp with time zone NOT NULL,
    host character varying(255) NOT NULL,
    display_path character varying(2048) NOT NULL,
    canonical_url character varying(4096),
    identity character varying(24) NOT NULL,
    identity_reason character varying(32),
    url_hash character varying(64),
    folder character varying(2048) NOT NULL,
    resource_class character varying(24) NOT NULL,
    method character varying(16) NOT NULL,
    status_code integer NOT NULL,
    bot_id character varying(64) NOT NULL,
    catalog_version character varying(32) NOT NULL,
    verification character varying(24) NOT NULL,
    verification_reason character varying(32),
    verification_basis character varying(32),
    ip_range_snapshot_id uuid,
    provider_request_id character varying(255),
    line_hash character varying(64) NOT NULL
);

CREATE TABLE public.brand_aliases (
    id uuid NOT NULL,
    brand_id uuid NOT NULL,
    alias character varying(255) NOT NULL,
    created_at timestamp with time zone NOT NULL
);

CREATE TABLE public.brand_discoveries (
    id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    project_id uuid,
    status character varying(24) NOT NULL,
    stage character varying(32) NOT NULL,
    progress jsonb NOT NULL,
    input_data jsonb NOT NULL,
    profile jsonb NOT NULL,
    domains jsonb NOT NULL,
    competitors jsonb NOT NULL,
    topics jsonb NOT NULL,
    prompt_suggestions jsonb NOT NULL,
    evidence jsonb NOT NULL,
    gaps jsonb NOT NULL,
    warnings jsonb NOT NULL,
    error_code character varying(32) NOT NULL,
    error_detail text NOT NULL,
    initial_crawl_id uuid,
    idempotency_key character varying(128) NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL
);

CREATE TABLE public.brand_discovery_tasks (
    id uuid NOT NULL,
    discovery_id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    task_kind character varying(32) NOT NULL,
    idempotency_key character varying(160) NOT NULL,
    status character varying(24) NOT NULL,
    priority integer NOT NULL,
    randomized_position integer NOT NULL,
    available_at timestamp with time zone NOT NULL,
    lease_owner character varying(64),
    lease_expires_at timestamp with time zone,
    heartbeat_at timestamp with time zone,
    attempt_count integer NOT NULL,
    max_attempts integer NOT NULL,
    error_code character varying(32) NOT NULL,
    error_detail text NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    completed_at timestamp with time zone
);

CREATE TABLE public.brand_fact_revisions (
    id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    fact_id uuid NOT NULL,
    revision integer NOT NULL,
    topic character varying(32) NOT NULL,
    statement text NOT NULL,
    source_url text,
    status character varying(16) NOT NULL,
    created_by_user_id uuid,
    created_at timestamp with time zone NOT NULL,
    CONSTRAINT ck_brand_fact_revision_status CHECK (((status)::text = ANY ((ARRAY['draft'::character varying, 'confirmed'::character varying, 'retired'::character varying])::text[])))
);

CREATE TABLE public.brand_facts (
    id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    project_id uuid NOT NULL,
    revision integer NOT NULL,
    topic character varying(32) NOT NULL,
    statement text NOT NULL,
    source_url text,
    status character varying(16) NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    CONSTRAINT ck_brand_fact_status CHECK (((status)::text = ANY ((ARRAY['draft'::character varying, 'confirmed'::character varying, 'retired'::character varying])::text[])))
);

CREATE TABLE public.brand_logo_assets (
    id uuid NOT NULL,
    domain character varying(255) NOT NULL,
    status character varying(16) NOT NULL,
    source_url character varying(2048) NOT NULL,
    content_type character varying(100) NOT NULL,
    image_data bytea,
    byte_size integer NOT NULL,
    sha256 character varying(64) NOT NULL,
    fetched_at timestamp with time zone,
    retry_after timestamp with time zone,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL
);

CREATE TABLE public.brand_mentions (
    id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    audit_id uuid NOT NULL,
    analysis_id uuid NOT NULL,
    artifact_id uuid NOT NULL,
    analyzer_version character varying(32) NOT NULL,
    brand_name character varying(255) NOT NULL,
    first_offset integer,
    created_at timestamp with time zone NOT NULL
);

CREATE TABLE public.brand_profiles (
    id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    project_id uuid NOT NULL,
    brand_id uuid NOT NULL,
    description text NOT NULL,
    positioning text NOT NULL,
    products_services jsonb NOT NULL,
    target_audience text NOT NULL,
    business_context jsonb NOT NULL,
    sources jsonb NOT NULL,
    source_artifact_ids jsonb NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL
);

CREATE TABLE public.brand_research_snapshots (
    id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    discovery_id uuid NOT NULL,
    research_version character varying(32) NOT NULL,
    provider character varying(255) NOT NULL,
    model character varying(255) NOT NULL,
    method character varying(64) NOT NULL,
    extracted_fields jsonb NOT NULL,
    field_confidence jsonb NOT NULL,
    evidence jsonb NOT NULL,
    warnings jsonb NOT NULL,
    created_at timestamp with time zone NOT NULL
);

CREATE TABLE public.branded_query_overrides (
    id uuid NOT NULL,
    ordinal bigint NOT NULL,
    workspace_id uuid NOT NULL,
    project_id uuid NOT NULL,
    normalized_query character varying(512) NOT NULL,
    classification character varying(16) NOT NULL,
    classifier_version character varying(32) NOT NULL,
    actor_user_id uuid NOT NULL,
    created_at timestamp with time zone NOT NULL
);

ALTER TABLE public.branded_query_overrides ALTER COLUMN ordinal ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.branded_query_overrides_ordinal_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);

CREATE TABLE public.brands (
    id uuid NOT NULL,
    project_id uuid NOT NULL,
    logo_asset_id uuid,
    name character varying(255) NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL
);

CREATE TABLE public.citations (
    id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    audit_id uuid NOT NULL,
    analysis_id uuid NOT NULL,
    artifact_id uuid NOT NULL,
    analyzer_version character varying(32) NOT NULL,
    ordinal integer NOT NULL,
    url text NOT NULL,
    title text NOT NULL,
    domain character varying(255) NOT NULL,
    classification character varying(24) NOT NULL,
    source_class character varying(48),
    source_origin character varying(24) DEFAULT 'external'::character varying NOT NULL,
    source_taxonomy_version character varying(32),
    is_owned boolean NOT NULL,
    is_unintended boolean NOT NULL,
    matched_competitor character varying(255),
    resolved_url text,
    canonical_url text,
    url_hash character varying(64),
    url_identity_method character varying(24),
    url_identity_version character varying(32),
    created_at timestamp with time zone NOT NULL
);

CREATE TABLE public.commerce_categories (
    id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    project_id uuid NOT NULL,
    name character varying(255) NOT NULL,
    normalized_name character varying(255) NOT NULL,
    role character varying(16) NOT NULL,
    canonical_url text NOT NULL,
    field_sources jsonb NOT NULL,
    source_analysis_id uuid,
    projector_version character varying(64) NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL
);

CREATE TABLE public.commerce_competitor_attempts (
    id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    project_id uuid NOT NULL,
    task_id uuid NOT NULL,
    target_kind character varying(16) NOT NULL,
    target_id uuid NOT NULL,
    attempt_number integer NOT NULL,
    query text NOT NULL,
    locale character varying(32) NOT NULL,
    status character varying(24) NOT NULL,
    result_payload jsonb NOT NULL,
    error_code character varying(64) NOT NULL,
    provider_version character varying(64) NOT NULL,
    validator_version character varying(64) NOT NULL,
    created_at timestamp with time zone NOT NULL
);

CREATE TABLE public.commerce_competitor_candidates (
    id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    project_id uuid NOT NULL,
    attempt_id uuid,
    target_kind character varying(16) NOT NULL,
    target_id uuid NOT NULL,
    canonical_url text NOT NULL,
    product_name character varying(512) NOT NULL,
    brand_name character varying(255) NOT NULL,
    evidence jsonb NOT NULL,
    source_kind character varying(24) NOT NULL,
    state character varying(16) NOT NULL,
    decision_at timestamp with time zone,
    created_at timestamp with time zone NOT NULL
);

CREATE TABLE public.commerce_csv_imports (
    id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    project_id uuid NOT NULL,
    content_hash character varying(64) NOT NULL,
    filename character varying(255) NOT NULL,
    content_type character varying(128) NOT NULL,
    raw_payload text NOT NULL,
    row_outcomes jsonb NOT NULL,
    created_count integer NOT NULL,
    updated_count integer NOT NULL,
    unchanged_count integer NOT NULL,
    rejected_count integer NOT NULL,
    importer_version character varying(64) NOT NULL,
    created_at timestamp with time zone NOT NULL
);

CREATE TABLE public.commerce_observation_citations (
    id uuid NOT NULL,
    observation_id uuid NOT NULL,
    citation_id uuid NOT NULL
);

CREATE TABLE public.commerce_product_categories (
    id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    project_id uuid NOT NULL,
    product_id uuid NOT NULL,
    category_id uuid NOT NULL,
    source_observation_id uuid,
    created_at timestamp with time zone NOT NULL
);

CREATE TABLE public.commerce_product_observations (
    id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    project_id uuid NOT NULL,
    product_id uuid NOT NULL,
    source_kind character varying(16) NOT NULL,
    source_analysis_id uuid,
    source_artifact_id uuid,
    csv_import_id uuid,
    csv_row_number integer,
    observed_fields jsonb NOT NULL,
    extractor_version character varying(64) NOT NULL,
    classifier_version character varying(64) NOT NULL,
    importer_version character varying(64) NOT NULL,
    projector_version character varying(64) NOT NULL,
    edit_version character varying(64) NOT NULL,
    created_at timestamp with time zone NOT NULL,
    CONSTRAINT ck_commerce_product_observation_source CHECK (((((source_kind)::text = 'site_health'::text) AND (source_analysis_id IS NOT NULL) AND (source_artifact_id IS NOT NULL) AND (csv_import_id IS NULL)) OR (((source_kind)::text = 'csv'::text) AND (csv_import_id IS NOT NULL) AND (csv_row_number IS NOT NULL) AND (source_analysis_id IS NULL)) OR (((source_kind)::text = 'edit'::text) AND (source_analysis_id IS NULL) AND (csv_import_id IS NULL))))
);

CREATE TABLE public.commerce_products (
    id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    project_id uuid NOT NULL,
    canonical_url text NOT NULL,
    name character varying(512) NOT NULL,
    description text NOT NULL,
    brand character varying(255) NOT NULL,
    price numeric(14,2),
    currency character varying(3) NOT NULL,
    sku character varying(255),
    gtin character varying(64),
    mpn character varying(255),
    observed_external_id character varying(255) NOT NULL,
    variants jsonb NOT NULL,
    attributes jsonb NOT NULL,
    field_sources jsonb NOT NULL,
    lifecycle_state character varying(16) NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL
);

CREATE TABLE public.commerce_prompt_targets (
    id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    project_id uuid NOT NULL,
    prompt_id uuid NOT NULL,
    target_kind character varying(16) NOT NULL,
    target_id uuid NOT NULL,
    template_version character varying(64) NOT NULL,
    approved_at timestamp with time zone,
    created_at timestamp with time zone NOT NULL
);

CREATE TABLE public.commerce_recommendation_observations (
    id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    project_id uuid NOT NULL,
    audit_id uuid NOT NULL,
    task_id uuid NOT NULL,
    artifact_id uuid NOT NULL,
    target_kind character varying(16) NOT NULL,
    target_id uuid NOT NULL,
    product_id uuid,
    competitor_candidate_id uuid,
    observed_product character varying(512) NOT NULL,
    observed_brand character varying(255) NOT NULL,
    classification character varying(32) NOT NULL,
    observed_title character varying(512) NOT NULL,
    observed_price numeric(14,2),
    observed_currency character varying(3) NOT NULL,
    merchant_url text NOT NULL,
    merchant_domain character varying(512) NOT NULL,
    surface_kind character varying(32) NOT NULL,
    rank integer,
    order_observable boolean NOT NULL,
    match_confidence double precision NOT NULL,
    parser_version character varying(64) NOT NULL,
    matcher_version character varying(64) NOT NULL,
    model_version character varying(128) NOT NULL,
    created_at timestamp with time zone NOT NULL
);

CREATE TABLE public.commerce_shelf_snapshots (
    id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    project_id uuid NOT NULL,
    audit_id uuid NOT NULL,
    target_kind character varying(16) NOT NULL,
    target_id uuid NOT NULL,
    product_visibility double precision NOT NULL,
    share_of_shelf double precision,
    average_shelf_position double precision,
    first_position_win_rate double precision,
    successful_execution_count integer NOT NULL,
    recognized_slot_count integer NOT NULL,
    ranked_execution_count integer NOT NULL,
    source_observation_ids jsonb NOT NULL,
    context_snapshot jsonb NOT NULL,
    formula_version character varying(64) NOT NULL,
    created_at timestamp with time zone NOT NULL
);

CREATE TABLE public.competitor_mentions (
    id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    audit_id uuid NOT NULL,
    analysis_id uuid NOT NULL,
    artifact_id uuid NOT NULL,
    analyzer_version character varying(32) NOT NULL,
    competitor_name character varying(255) NOT NULL,
    first_offset integer,
    created_at timestamp with time zone NOT NULL
);

CREATE TABLE public.competitors (
    id uuid NOT NULL,
    project_id uuid NOT NULL,
    logo_asset_id uuid,
    name character varying(255) NOT NULL,
    aliases jsonb NOT NULL,
    domains jsonb NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL
);

CREATE TABLE public.consumable_ledger (
    id uuid NOT NULL,
    billing_account_id uuid NOT NULL,
    grant_id uuid NOT NULL,
    capability_key character varying(64) NOT NULL,
    entry_kind character varying(16) NOT NULL,
    reservation_id uuid NOT NULL,
    subject_kind character varying(16) NOT NULL,
    subject_id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    audit_id uuid,
    task_id uuid,
    agent_run_id uuid,
    site_crawl_id uuid,
    platform_call_id uuid,
    dispatch_key character varying(128) NOT NULL,
    request_fingerprint character varying(64) NOT NULL,
    allocation_order integer NOT NULL,
    refund_of_id uuid,
    attempt integer,
    units integer NOT NULL,
    idempotency_key character varying(255) NOT NULL,
    created_at timestamp with time zone NOT NULL,
    CONSTRAINT ck_consumable_ledger_attempt_shape CHECK (((((entry_kind)::text = ANY ((ARRAY['debit'::character varying, 'refund'::character varying])::text[])) AND (attempt IS NOT NULL) AND (attempt > 0)) OR (((entry_kind)::text <> ALL ((ARRAY['debit'::character varying, 'refund'::character varying])::text[])) AND (attempt IS NULL)))),
    CONSTRAINT ck_consumable_ledger_entry_kind CHECK (((entry_kind)::text = ANY ((ARRAY['reservation'::character varying, 'debit'::character varying, 'release'::character varying, 'refund'::character varying])::text[]))),
    CONSTRAINT ck_consumable_ledger_refund_shape CHECK ((((entry_kind)::text = 'refund'::text) = (refund_of_id IS NOT NULL))),
    CONSTRAINT ck_consumable_ledger_typed_subject CHECK (((((subject_kind)::text = 'audit'::text) AND (audit_id IS NOT NULL) AND (task_id IS NOT NULL) AND (agent_run_id IS NULL) AND (site_crawl_id IS NULL) AND (platform_call_id IS NULL)) OR (((subject_kind)::text = 'agent'::text) AND (audit_id IS NULL) AND (task_id IS NULL) AND (agent_run_id IS NOT NULL) AND (site_crawl_id IS NULL) AND (platform_call_id IS NULL)) OR (((subject_kind)::text = 'site_crawl'::text) AND (audit_id IS NULL) AND (task_id IS NULL) AND (agent_run_id IS NULL) AND (site_crawl_id IS NOT NULL) AND (platform_call_id IS NULL)) OR (((subject_kind)::text = 'platform_call'::text) AND (audit_id IS NULL) AND (task_id IS NULL) AND (agent_run_id IS NULL) AND (site_crawl_id IS NULL) AND (platform_call_id IS NOT NULL)))),
    CONSTRAINT ck_consumable_ledger_units_positive CHECK ((units > 0))
);

CREATE TABLE public.content_differentiation_candidates (
    id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    project_id uuid NOT NULL,
    audit_id uuid NOT NULL,
    audit_task_id uuid NOT NULL,
    source_page_id uuid NOT NULL,
    query_text text NOT NULL,
    rank integer NOT NULL,
    result_title text NOT NULL,
    search_context jsonb NOT NULL,
    created_at timestamp with time zone NOT NULL
);

CREATE TABLE public.content_differentiation_reports (
    id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    project_id uuid NOT NULL,
    audit_id uuid NOT NULL,
    audit_task_id uuid NOT NULL,
    owned_site_url_id uuid,
    formula_version character varying(64) NOT NULL,
    report jsonb NOT NULL,
    created_at timestamp with time zone NOT NULL
);

CREATE TABLE public.crawl_log_batches (
    id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    project_id uuid NOT NULL,
    source_id uuid NOT NULL,
    upload_id uuid,
    seq integer,
    idempotency_key character varying(255) NOT NULL,
    received_at timestamp with time zone NOT NULL,
    format character varying(24) NOT NULL,
    status character varying(24) NOT NULL,
    missing_fields jsonb NOT NULL,
    parser_version character varying(32) NOT NULL,
    catalog_version character varying(32) NOT NULL,
    lines_received integer NOT NULL,
    lines_parsed integer NOT NULL,
    lines_matched integer NOT NULL,
    lines_unmatched integer NOT NULL,
    lines_out_of_scope integer NOT NULL,
    lines_rejected integer NOT NULL,
    lines_duplicate integer NOT NULL,
    lines_overlapping integer NOT NULL,
    first_line_at timestamp with time zone,
    last_line_at timestamp with time zone,
    heartbeat boolean NOT NULL,
    bytes_received integer NOT NULL,
    drained boolean NOT NULL,
    CONSTRAINT ck_crawl_log_batches_drained CHECK (((NOT drained) OR heartbeat))
);

CREATE TABLE public.crawl_log_coverage_daily (
    id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    project_id uuid NOT NULL,
    source_id uuid NOT NULL,
    reporting_date date NOT NULL,
    reporting_timezone character varying(64) NOT NULL,
    coverage character varying(24) NOT NULL,
    reason character varying(64) NOT NULL,
    batch_count integer NOT NULL,
    heartbeat_count integer NOT NULL,
    max_gap_minutes double precision NOT NULL
);

CREATE TABLE public.crawl_log_sources (
    id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    project_id uuid NOT NULL,
    kind character varying(24) NOT NULL,
    setup character varying(32) NOT NULL,
    preset character varying(64) NOT NULL,
    format character varying(24) NOT NULL,
    collection_point character varying(24) NOT NULL,
    sampling jsonb NOT NULL,
    origin character varying(512) NOT NULL,
    host character varying(255) NOT NULL,
    accepted_hosts jsonb NOT NULL,
    token_hash character varying(64),
    token_prefix character varying(24),
    status character varying(24) NOT NULL,
    created_by_member_id uuid NOT NULL,
    created_at timestamp with time zone NOT NULL,
    revoked_at timestamp with time zone,
    last_processed_at timestamp with time zone,
    stall_reason character varying(32),
    stalled_at timestamp with time zone,
    buffer_interval_seconds integer,
    declared_filtered boolean NOT NULL,
    subscription character varying(255),
    verification_nonce character varying(26),
    verified_at timestamp with time zone,
    verification_checked_at timestamp with time zone,
    verification_failure character varying(32),
    filter_catalog_version character varying(16),
    filter_confirmed_at timestamp with time zone,
    declared_sample_rate numeric(4,3),
    last_pull_at timestamp with time zone,
    last_drained_at timestamp with time zone,
    CONSTRAINT ck_crawl_log_sources_pull CHECK ((((kind)::text = 'pull'::text) = (subscription IS NOT NULL)) AND (((kind)::text = 'pull'::text) = (verification_nonce IS NOT NULL)) AND (((kind)::text = 'pull'::text) = (filter_catalog_version IS NOT NULL)) AND (((kind)::text = 'pull'::text) = (declared_sample_rate IS NOT NULL)) AND ((declared_sample_rate IS NULL) OR ((declared_sample_rate > (0)::numeric) AND (declared_sample_rate <= (1)::numeric)))),
    CONSTRAINT ck_crawl_log_sources_verification_failure CHECK ((((COALESCE(stall_reason, ''::character varying))::text = 'verification_failed'::text) = (verification_failure IS NOT NULL))),
    CONSTRAINT ck_crawl_log_sources_buffer_interval CHECK ((((setup)::text = 'aws_firehose'::text) = (buffer_interval_seconds IS NOT NULL)) AND ((buffer_interval_seconds IS NULL) OR ((buffer_interval_seconds >= 60) AND (buffer_interval_seconds <= 900)))),
    CONSTRAINT ck_crawl_log_sources_stall CHECK (((stall_reason IS NULL) = (stalled_at IS NULL)))
);

CREATE TABLE public.crawl_log_states (
    id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    project_id uuid NOT NULL,
    reporting_timezone character varying(64) NOT NULL,
    updated_at timestamp with time zone NOT NULL
);

CREATE TABLE public.crawl_log_uploads (
    id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    project_id uuid NOT NULL,
    source_id uuid NOT NULL,
    filename character varying(255) NOT NULL,
    size_bytes bigint NOT NULL,
    status character varying(24) NOT NULL,
    missing_fields jsonb NOT NULL,
    last_ack_seq integer NOT NULL,
    scanned_lines integer NOT NULL,
    first_line_at timestamp with time zone,
    last_line_at timestamp with time zone,
    scanned_dates jsonb NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    completed_at timestamp with time zone
);

CREATE TABLE public.demand_signals (
    id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    project_id uuid NOT NULL,
    snapshot_id uuid NOT NULL,
    identity_hash character varying(64) NOT NULL,
    signal_type character varying(64) NOT NULL,
    state character varying(24) NOT NULL,
    topic_cluster character varying(512) NOT NULL,
    page_url character varying(2048) NOT NULL,
    evidence jsonb NOT NULL,
    metrics jsonb NOT NULL,
    coverage jsonb NOT NULL,
    limitations jsonb NOT NULL,
    priority_score double precision,
    priority_inputs jsonb NOT NULL,
    analyzer_version character varying(32) NOT NULL,
    rule_version character varying(32) NOT NULL,
    formula_version character varying(32) NOT NULL,
    created_at timestamp with time zone NOT NULL
);

CREATE TABLE public.demand_snapshots (
    id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    project_id uuid NOT NULL,
    window_start date NOT NULL,
    window_end date NOT NULL,
    source_hash character varying(64) NOT NULL,
    prior_snapshot_id uuid,
    source_artifact_ids jsonb NOT NULL,
    source_metric_row_ids jsonb NOT NULL,
    coverage jsonb NOT NULL,
    summary jsonb NOT NULL,
    comparison jsonb,
    formula_version character varying(32) NOT NULL,
    analyzer_version character varying(32) NOT NULL,
    created_at timestamp with time zone NOT NULL
);

CREATE TABLE public.enterprise_agreement_references (
    id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    actor_id uuid NOT NULL,
    signatory_id uuid NOT NULL,
    reference character varying(128) NOT NULL,
    document_sha256 character varying(64) NOT NULL,
    signed_at timestamp with time zone NOT NULL,
    recorded_at timestamp with time zone NOT NULL
);

CREATE TABLE public.entity_sentiments (
    id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    perception_id uuid NOT NULL,
    entity_id character varying(512) NOT NULL,
    entity_name character varying(255) NOT NULL,
    entity_kind character varying(16) NOT NULL,
    label character varying(16) NOT NULL,
    confidence double precision,
    low_confidence boolean NOT NULL,
    passage_spans jsonb NOT NULL,
    aspects jsonb NOT NULL,
    CONSTRAINT ck_entity_sentiment_label CHECK (((label)::text = ANY ((ARRAY['positive'::character varying, 'neutral'::character varying, 'negative'::character varying, 'mixed'::character varying, 'not_assessable'::character varying])::text[])))
);

CREATE TABLE public.fact_verifications (
    id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    project_id uuid NOT NULL,
    audit_id uuid NOT NULL,
    task_id uuid NOT NULL,
    perception_id uuid NOT NULL,
    verify_template_version character varying(64) NOT NULL,
    model_provider character varying(32),
    model character varying(255),
    input_hash character varying(64),
    outcome character varying(32) NOT NULL,
    outcome_reason character varying(64),
    drop_counts jsonb DEFAULT '{}'::jsonb NOT NULL,
    usage jsonb,
    latency_ms integer,
    created_at timestamp with time zone NOT NULL,
    CONSTRAINT ck_fact_verification_outcome CHECK (((outcome)::text = ANY ((ARRAY['verified'::character varying, 'unavailable'::character varying, 'invalid_output'::character varying, 'model_error'::character varying])::text[])))
);

CREATE TABLE public.claim_verdicts (
    id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    verification_id uuid NOT NULL,
    claim_id uuid NOT NULL,
    verdict character varying(16) NOT NULL,
    model_verdict character varying(16),
    fact_revision_ids jsonb NOT NULL,
    confidence double precision,
    low_confidence boolean NOT NULL,
    CONSTRAINT ck_claim_verdict_verdict CHECK (((verdict)::text = ANY ((ARRAY['supported'::character varying, 'contradicted'::character varying, 'inconclusive'::character varying, 'not_covered'::character varying])::text[])))
);

CREATE TABLE public.execution_cost_projections (
    id uuid NOT NULL,
    audit_id uuid NOT NULL,
    task_id uuid NOT NULL,
    raw_response_artifact_id uuid NOT NULL,
    formula_version character varying(32) NOT NULL,
    pricing_version character varying(64) NOT NULL,
    projection_status character varying(16) NOT NULL,
    uncached_input_tokens integer,
    cached_input_tokens integer,
    output_tokens integer,
    reasoning_tokens integer,
    total_tokens integer,
    search_requests integer,
    attempt_count integer,
    uncached_input_cost_microusd bigint,
    cached_input_cost_microusd bigint,
    output_cost_microusd bigint,
    reasoning_cost_microusd bigint,
    search_cost_microusd bigint,
    provider_reported_cost_microusd bigint,
    projected_total_cost_microusd bigint,
    created_at timestamp with time zone NOT NULL
);

CREATE TABLE public.grant_revocations (
    id uuid NOT NULL,
    grant_id uuid NOT NULL,
    effective_from timestamp with time zone NOT NULL,
    reason character varying(255) NOT NULL,
    actor_user_id uuid,
    actor_kind character varying(24) NOT NULL,
    idempotency_key character varying(255) NOT NULL,
    created_at timestamp with time zone NOT NULL
);

CREATE TABLE public.idempotency_records (
    id uuid NOT NULL,
    billing_account_id uuid NOT NULL,
    idempotency_key character varying(255) NOT NULL,
    operation character varying(64) NOT NULL,
    request_fingerprint character varying(64) NOT NULL,
    state character varying(16) NOT NULL,
    response_status integer,
    response_body jsonb,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL
);

CREATE TABLE public.integration_connections (
    id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    grant_id uuid NOT NULL,
    provider character varying(16) NOT NULL,
    label character varying(255) NOT NULL,
    account_ref character varying(1024) NOT NULL,
    dataset_capabilities jsonb NOT NULL,
    last_synced_at timestamp with time zone,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL
);

CREATE TABLE public.integration_events (
    id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    connection_id uuid,
    grant_id uuid,
    event_type character varying(48) NOT NULL,
    message text NOT NULL,
    payload jsonb,
    created_at timestamp with time zone NOT NULL
);

CREATE TABLE public.integration_import_artifacts (
    id uuid NOT NULL,
    sync_run_id uuid NOT NULL,
    connection_id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    provider character varying(16) NOT NULL,
    dataset character varying(48) NOT NULL,
    query_snapshot jsonb,
    payload_hash character varying(64) NOT NULL,
    fetched_at timestamp with time zone NOT NULL,
    row_count integer NOT NULL,
    payload jsonb,
    extract_metadata jsonb,
    created_at timestamp with time zone NOT NULL
);

CREATE TABLE public.integration_metric_rows (
    id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    project_id uuid NOT NULL,
    property_ref character varying(512) NOT NULL,
    provider character varying(16) NOT NULL,
    dataset character varying(48) NOT NULL,
    date date NOT NULL,
    dimension_key character varying(1024) NOT NULL,
    metrics jsonb,
    source_artifact_id uuid NOT NULL,
    resync_seq integer NOT NULL,
    importer_version character varying(64) NOT NULL,
    created_at timestamp with time zone NOT NULL
);

CREATE TABLE public.integration_oauth_grants (
    id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    transport character varying(24) NOT NULL,
    access_token_encrypted text NOT NULL,
    refresh_token_encrypted text NOT NULL,
    token_expires_at timestamp with time zone,
    token_revision integer NOT NULL,
    refresh_claim_id uuid,
    refresh_claim_expires_at timestamp with time zone,
    granted_scopes jsonb,
    status character varying(24) NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL
);

CREATE TABLE public.integration_oauth_states (
    id uuid NOT NULL,
    jti character varying(64) NOT NULL,
    workspace_id uuid NOT NULL,
    user_id uuid NOT NULL,
    provider character varying(16) NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    consumed_at timestamp with time zone,
    created_at timestamp with time zone NOT NULL
);

CREATE TABLE public.integration_property_mappings (
    id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    connection_id uuid NOT NULL,
    provider character varying(16) NOT NULL,
    property_ref character varying(512) NOT NULL,
    project_id uuid NOT NULL,
    status character varying(16) NOT NULL,
    reporting_timezone character varying(128),
    currency_code character varying(3),
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL
);

CREATE TABLE public.integration_sync_runs (
    id uuid NOT NULL,
    connection_id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    mapping_id uuid NOT NULL,
    property_ref character varying(512) NOT NULL,
    project_id uuid NOT NULL,
    sync_kind character varying(16) NOT NULL,
    window_start date NOT NULL,
    window_end date NOT NULL,
    resync_seq integer NOT NULL,
    idempotency_key character varying(160) NOT NULL,
    status character varying(24) NOT NULL,
    priority integer NOT NULL,
    randomized_position integer NOT NULL,
    available_at timestamp with time zone NOT NULL,
    lease_owner character varying(64),
    lease_expires_at timestamp with time zone,
    heartbeat_at timestamp with time zone,
    attempt_count integer NOT NULL,
    max_attempts integer NOT NULL,
    error_code character varying(32) NOT NULL,
    error_detail text NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    completed_at timestamp with time zone
);

CREATE TABLE public.introductory_claims (
    id uuid NOT NULL,
    billing_account_id uuid NOT NULL,
    campaign_id uuid NOT NULL,
    introduction_kind character varying(32) NOT NULL,
    tier_key character varying(64) NOT NULL,
    primary_grant_id uuid NOT NULL,
    idempotency_key character varying(255) NOT NULL,
    request_fingerprint character varying(64) NOT NULL,
    terms_consent_version character varying(64) NOT NULL,
    data_sharing_consent_version character varying(64) NOT NULL,
    consented_by_user_id uuid NOT NULL,
    claimed_at timestamp with time zone NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    operator_code_id uuid,
    ended_at timestamp with time zone,
    ended_by_user_id uuid,
    created_at timestamp with time zone NOT NULL
);

CREATE TABLE public.introductory_operator_codes (
    id uuid NOT NULL,
    code_sha256 character varying(64) NOT NULL,
    billing_account_id uuid,
    email_normalized character varying(255),
    waiver_scope character varying(64) NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    redemption_limit integer NOT NULL,
    redemption_count integer NOT NULL,
    created_by_user_id uuid NOT NULL,
    reason character varying(255) NOT NULL,
    created_at timestamp with time zone NOT NULL,
    CONSTRAINT ck_intro_code_count_nonnegative CHECK ((redemption_count >= 0)),
    CONSTRAINT ck_intro_code_limit_positive CHECK ((redemption_limit > 0))
);

CREATE TABLE public.mcp_authorization_codes (
    workspace_ids jsonb NOT NULL,
    id uuid NOT NULL,
    code_hash character varying(64) NOT NULL,
    client_id character varying(36) NOT NULL,
    user_id uuid NOT NULL,
    scopes jsonb NOT NULL,
    code_challenge character varying(128) NOT NULL,
    redirect_uri text NOT NULL,
    redirect_uri_provided_explicitly boolean NOT NULL,
    resource text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    consumed_at timestamp with time zone,
    created_at timestamp with time zone NOT NULL
);

CREATE TABLE public.mcp_authorization_requests (
    id uuid NOT NULL,
    transaction_hash character varying(64) NOT NULL,
    client_id character varying(36) NOT NULL,
    state text NOT NULL,
    scopes jsonb NOT NULL,
    code_challenge character varying(128) NOT NULL,
    redirect_uri text NOT NULL,
    redirect_uri_provided_explicitly boolean NOT NULL,
    resource text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    consumed_at timestamp with time zone,
    created_at timestamp with time zone NOT NULL
);

CREATE TABLE public.mcp_confirmations (
    id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    grant_id uuid NOT NULL,
    user_id uuid NOT NULL,
    kind character varying(40) NOT NULL,
    project_id uuid NOT NULL,
    payload jsonb NOT NULL,
    payload_hash character varying(64) NOT NULL,
    token_hmac character varying(64) NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    consumed_at timestamp with time zone,
    created_at timestamp with time zone NOT NULL,
    CONSTRAINT ck_mcp_confirmations_kind CHECK (((kind)::text = ANY ((ARRAY['add_prompts'::character varying, 'archive_prompts'::character varying, 'launch_audit'::character varying, 'schedule'::character varying, 'declare_implemented'::character varying])::text[])))
);

CREATE TABLE public.mcp_oauth_clients (
    id uuid NOT NULL,
    client_id character varying(36) NOT NULL,
    client_secret_encrypted text NOT NULL,
    client_metadata jsonb NOT NULL,
    created_at timestamp with time zone NOT NULL
);

CREATE TABLE public.mcp_oauth_grants (
    workspace_ids jsonb NOT NULL,
    id uuid NOT NULL,
    client_id character varying(36) NOT NULL,
    user_id uuid NOT NULL,
    access_token_hash character varying(64) NOT NULL,
    refresh_token_hash character varying(64) NOT NULL,
    scopes jsonb NOT NULL,
    resource text NOT NULL,
    access_expires_at timestamp with time zone NOT NULL,
    refresh_expires_at timestamp with time zone NOT NULL,
    revoked_at timestamp with time zone,
    previous_refresh_token_hash character varying(64),
    refresh_rotated_at timestamp with time zone,
    authorization_code_id uuid,
    last_used_at timestamp with time zone,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL
);

CREATE TABLE public.metric_snapshots (
    id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    audit_id uuid NOT NULL,
    project_id uuid NOT NULL,
    analyzer_version character varying(32) NOT NULL,
    scoring_rule_version character varying(32) NOT NULL,
    total_completed integer NOT NULL,
    total_failed integer NOT NULL,
    visibility_score double precision NOT NULL,
    metrics jsonb,
    source_analysis_ids jsonb,
    source_artifact_ids jsonb,
    created_at timestamp with time zone NOT NULL
);

CREATE TABLE public.monitored_site_urls (
    id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    project_id uuid NOT NULL,
    profile_id uuid NOT NULL,
    site_url_id uuid NOT NULL,
    active boolean NOT NULL,
    selection_source character varying(16) NOT NULL,
    selecting_membership_id integer,
    selected_at timestamp with time zone NOT NULL,
    deselected_at timestamp with time zone,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL
);

CREATE TABLE public.observed_entity_candidates (
    id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    project_id uuid NOT NULL,
    audit_id uuid NOT NULL,
    name character varying(255) NOT NULL,
    domain character varying(255) NOT NULL,
    qualification_reason text NOT NULL,
    prompt_count integer NOT NULL,
    engine_count integer NOT NULL,
    market_relevant boolean NOT NULL,
    analyzer_version character varying(32) NOT NULL,
    source_analysis_ids jsonb NOT NULL,
    source_artifact_ids jsonb NOT NULL,
    status character varying(16) NOT NULL,
    created_at timestamp with time zone NOT NULL
);

CREATE TABLE public.opportunities (
    id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    project_id uuid NOT NULL,
    rule_id character varying(64) NOT NULL,
    opportunity_type character varying(16) NOT NULL,
    severity character varying(16) NOT NULL,
    priority_score double precision NOT NULL,
    title character varying(255) NOT NULL,
    remediation text NOT NULL,
    target_key character varying(512) NOT NULL,
    target_prompt_id uuid,
    target_url text,
    target_theme character varying(255),
    evidence jsonb,
    source_analysis_ids jsonb,
    source_issue_ids jsonb,
    source_metric_ids jsonb,
    source_traffic_ids jsonb,
    analyzer_version character varying(32) NOT NULL,
    rule_version character varying(32) NOT NULL,
    formula_version character varying(32) NOT NULL,
    action_id uuid,
    superseded_by_id uuid,
    superseded_at timestamp with time zone,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL
);

CREATE TABLE public.opportunity_implementation_events (
    id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    project_id uuid NOT NULL,
    action_id uuid NOT NULL,
    output_revision_id uuid,
    member_opportunity_ids jsonb NOT NULL,
    opportunity_snapshot_id uuid NOT NULL,
    target_site_url_ids jsonb NOT NULL,
    target_external_url text,
    declared_implemented_at timestamp with time zone NOT NULL,
    expected_checks jsonb NOT NULL,
    actor_user_id uuid NOT NULL,
    idempotency_key character varying(160) NOT NULL,
    request_fingerprint character varying(64) NOT NULL,
    created_at timestamp with time zone NOT NULL,
    CONSTRAINT ck_opportunity_implementation_single_target CHECK (((jsonb_array_length(target_site_url_ids) = 0) OR (target_external_url IS NULL)))
);

CREATE TABLE public.opportunity_orders (
    id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    project_id uuid NOT NULL,
    ordered_keys jsonb NOT NULL,
    version integer NOT NULL,
    updated_by_user_id uuid NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL
);

CREATE TABLE public.opportunity_snapshots (
    id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    project_id uuid NOT NULL,
    run_id uuid NOT NULL,
    audit_id uuid,
    site_crawl_id uuid,
    demand_snapshot_id uuid,
    demand_source_revision character varying(64),
    coverage jsonb,
    limitations jsonb NOT NULL,
    source_mix jsonb,
    counts_by_type jsonb,
    counts_by_severity jsonb,
    total_count integer NOT NULL,
    median_priority double precision,
    analyzer_version character varying(32) NOT NULL,
    rule_version character varying(32) NOT NULL,
    formula_version character varying(32) NOT NULL,
    source_analysis_ids jsonb,
    source_issue_ids jsonb,
    created_at timestamp with time zone NOT NULL
);

CREATE TABLE public.opportunity_verification_events (
    id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    project_id uuid NOT NULL,
    implementation_event_id uuid NOT NULL,
    observation_kind character varying(16) NOT NULL,
    observed_at timestamp with time zone NOT NULL,
    crawl_id uuid,
    audit_id uuid,
    source_analysis_ids jsonb NOT NULL,
    source_rule_evaluation_ids jsonb NOT NULL,
    source_metric_ids jsonb NOT NULL,
    result jsonb,
    verifier_version character varying(32) NOT NULL,
    limitations jsonb NOT NULL,
    idempotency_key character varying(160) NOT NULL,
    created_at timestamp with time zone NOT NULL
);

CREATE TABLE public.overview_layouts (
    id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    project_id uuid NOT NULL,
    widgets jsonb,
    version integer NOT NULL,
    updated_by_user_id uuid NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL
);

CREATE TABLE public.owned_domains (
    id uuid NOT NULL,
    project_id uuid NOT NULL,
    domain character varying(255) NOT NULL,
    created_at timestamp with time zone NOT NULL
);

CREATE TABLE public.pending_activations (
    id uuid NOT NULL,
    billing_account_id uuid NOT NULL,
    activation_kind character varying(16) NOT NULL,
    catalog_key character varying(64) NOT NULL,
    quantity integer NOT NULL,
    catalog_revision character varying(64) NOT NULL,
    credential_mode character varying(16) NOT NULL,
    status character varying(16) NOT NULL,
    provider character varying(24) NOT NULL,
    provider_mode character varying(8) NOT NULL,
    external_reference character varying(255),
    external_price_id character varying(255),
    quote jsonb,
    tax_snapshot jsonb,
    change_terms jsonb,
    country_code character varying(2) NOT NULL,
    region character varying(16) NOT NULL,
    settled_by character varying(24),
    settled_authority_id character varying(255),
    idempotency_key character varying(255) NOT NULL,
    request_fingerprint character varying(64) NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    activated_at timestamp with time zone,
    failed_at timestamp with time zone,
    failure_code character varying(64),
    reconciliation_attempts integer DEFAULT 0 NOT NULL,
    reconciliation_next_at timestamp with time zone,
    reconciliation_lease_token uuid,
    reconciliation_lease_expires_at timestamp with time zone,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    CONSTRAINT ck_pending_activation_quantity_positive CHECK ((quantity > 0))
);

CREATE TABLE public.performance_dimension_stats (
    id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    project_id uuid NOT NULL,
    snapshot_id uuid NOT NULL,
    dimension character varying(32) NOT NULL,
    dimension_key character varying(2048) NOT NULL,
    display_value character varying(2048) NOT NULL,
    metrics jsonb,
    source_metric_row_ids jsonb,
    source_artifact_ids jsonb,
    created_at timestamp with time zone NOT NULL
);

CREATE TABLE public.platform_calls (
    id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    billing_account_id uuid,
    feature character varying(48) NOT NULL,
    provider character varying(32) NOT NULL,
    model character varying(255) NOT NULL,
    charge character varying(16) NOT NULL,
    status character varying(16) NOT NULL,
    pricing_revision character varying(64) NOT NULL,
    reservation_id uuid,
    reserved_credits integer NOT NULL,
    credits integer NOT NULL,
    owner_settled boolean NOT NULL,
    input_tokens integer,
    cached_input_tokens integer,
    output_tokens integer,
    cost_microusd bigint,
    error_code character varying(64) NOT NULL,
    created_at timestamp with time zone NOT NULL,
    settled_at timestamp with time zone,
    CONSTRAINT ck_platform_calls_charge CHECK (((charge)::text = ANY ((ARRAY['credits'::character varying, 'included'::character varying, 'not_charged'::character varying])::text[]))),
    CONSTRAINT ck_platform_calls_status CHECK (((status)::text = ANY ((ARRAY['reserved'::character varying, 'settled'::character varying, 'failed'::character varying])::text[]))),
    CONSTRAINT ck_platform_calls_credits CHECK (((credits >= 0) AND (reserved_credits >= 0) AND (credits <= reserved_credits))),
    CONSTRAINT ck_platform_calls_hold CHECK (((((charge)::text = 'credits'::text) AND (billing_account_id IS NOT NULL) AND (reserved_credits > 0)) OR (((charge)::text <> 'credits'::text) AND (reservation_id IS NULL) AND (reserved_credits = 0)))),
    CONSTRAINT ck_platform_calls_settled CHECK ((((status)::text = 'reserved'::text) = (settled_at IS NULL)))
);

CREATE TABLE public.policy_acceptances (
    id uuid NOT NULL,
    actor_id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    terms_revision character varying(64) NOT NULL,
    privacy_notice_revision character varying(64) NOT NULL,
    context character varying(32) NOT NULL,
    accepted_at timestamp with time zone NOT NULL
);

CREATE TABLE public.project_markets (
    id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    project_id uuid NOT NULL,
    label character varying(64) NOT NULL,
    country_code character varying(2) NOT NULL,
    language_code character varying(16) NOT NULL,
    created_at timestamp with time zone NOT NULL
);

CREATE TABLE public.projects (
    id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    name character varying(255) NOT NULL,
    brand_name character varying(255) NOT NULL,
    website_url character varying(1024) NOT NULL,
    country_code character varying(8) NOT NULL,
    language_code character varying(16) NOT NULL,
    industry character varying(255) NOT NULL,
    subindustry character varying(255) NOT NULL,
    primary_market character varying(8) NOT NULL,
    benchmark_mode character varying(32) NOT NULL,
    serp_location_code integer DEFAULT 0 NOT NULL,
    serp_language_code character varying(8) DEFAULT ''::character varying NOT NULL,
    serp_device character varying(16) DEFAULT 'desktop'::character varying NOT NULL,
    default_repetitions integer NOT NULL,
    search_intelligence_preferences jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL
);

CREATE TABLE public.prompt_candidates (
    id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    run_id uuid NOT NULL,
    prompt_set_id uuid NOT NULL,
    topic_id uuid,
    text text NOT NULL,
    normalized_text_hash character varying(64) NOT NULL,
    intent character varying(32) NOT NULL,
    buyer_stage character varying(16) NOT NULL,
    prompt_intent character varying(16) NOT NULL,
    cohort character varying(32) NOT NULL,
    slot_id character varying(128) NOT NULL,
    evidence_refs jsonb NOT NULL,
    validation jsonb NOT NULL,
    jev_decision jsonb,
    disposition character varying(16) NOT NULL,
    prompt_id uuid,
    created_at timestamp with time zone NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    reviewed_at timestamp with time zone
);

CREATE TABLE public.prompt_generation_runs (
    id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    project_id uuid NOT NULL,
    prompt_set_id uuid NOT NULL,
    generator_version character varying(64) NOT NULL,
    request jsonb NOT NULL,
    provenance jsonb NOT NULL,
    created_at timestamp with time zone NOT NULL
);

CREATE TABLE public.prompt_metric_snapshots (
    id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    project_id uuid NOT NULL,
    audit_id uuid NOT NULL,
    prompt_id uuid,
    prompt_identity character varying(64) NOT NULL,
    prompt_index integer NOT NULL,
    prompt_text text NOT NULL,
    cohort character varying(32) NOT NULL,
    analyzer_version character varying(32) NOT NULL,
    scoring_rule_version character varying(32) NOT NULL,
    composite_score double precision NOT NULL,
    previous_score double precision,
    immediate_delta double precision,
    rolling_four jsonb NOT NULL,
    per_engine_scores jsonb NOT NULL,
    components jsonb NOT NULL,
    engine_agreement double precision NOT NULL,
    repetition_agreement double precision NOT NULL,
    evidence_coverage double precision NOT NULL,
    trend_confidence double precision NOT NULL,
    decline_confirmed boolean NOT NULL,
    source_analysis_ids jsonb NOT NULL,
    source_artifact_ids jsonb NOT NULL,
    created_at timestamp with time zone NOT NULL
);

CREATE TABLE public.prompt_sets (
    id uuid NOT NULL,
    project_id uuid NOT NULL,
    name character varying(255) NOT NULL,
    description character varying(1024) NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL
);

CREATE TABLE public.prompts (
    id uuid NOT NULL,
    prompt_set_id uuid NOT NULL,
    topic_id uuid,
    text text NOT NULL,
    normalized_text_hash character varying(64) NOT NULL,
    theme character varying(255) NOT NULL,
    intent character varying(32) NOT NULL,
    buyer_stage character varying(16) DEFAULT ''::character varying NOT NULL,
    prompt_intent character varying(16) DEFAULT ''::character varying NOT NULL,
    persona character varying(120) DEFAULT ''::character varying NOT NULL,
    branded boolean NOT NULL,
    enabled boolean NOT NULL,
    cohort character varying(32) DEFAULT 'core'::character varying NOT NULL,
    status character varying(16) DEFAULT 'active'::character varying NOT NULL,
    origin character varying(32) NOT NULL,
    generation_evidence jsonb,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL
);

CREATE TABLE public.provider_attempts (
    id uuid NOT NULL,
    task_id uuid NOT NULL,
    audit_id uuid NOT NULL,
    attempt_number integer NOT NULL,
    logical_engine character varying(32) NOT NULL,
    transport_provider character varying(32) NOT NULL,
    transport_model character varying(255) NOT NULL,
    status character varying(16) NOT NULL,
    error_code character varying(32) NOT NULL,
    error_detail text NOT NULL,
    latency_ms integer,
    artifact_id uuid,
    created_at timestamp with time zone NOT NULL
);

CREATE TABLE public.provider_capacity_buckets (
    id uuid NOT NULL,
    pool_kind character varying(16) NOT NULL,
    transport_provider character varying(32) NOT NULL,
    account_pool_identity character varying(64) DEFAULT ''::character varying NOT NULL,
    connection_id uuid,
    billing_account_id uuid,
    capacity numeric(14,4) NOT NULL,
    tokens numeric(14,4) NOT NULL,
    refill_tokens_per_second numeric(14,4) NOT NULL,
    refilled_at timestamp with time zone NOT NULL,
    blocked_until timestamp with time zone,
    policy_version character varying(32) NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL
);

CREATE TABLE public.provider_capacity_leases (
    id uuid NOT NULL,
    bucket_id uuid NOT NULL,
    task_id uuid,
    analytics_task_id uuid,
    attempt_number integer NOT NULL,
    lease_kind character varying(16) NOT NULL,
    units numeric(14,4) NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    released_at timestamp with time zone,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    CONSTRAINT ck_provider_capacity_lease_one_parent CHECK (((((task_id IS NOT NULL))::integer + ((analytics_task_id IS NOT NULL))::integer) = 1))
);

CREATE TABLE public.provider_connection_tests (
    id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    connection_id uuid NOT NULL,
    status character varying(16) NOT NULL,
    error_code character varying(32) NOT NULL,
    detail character varying(1024) NOT NULL,
    latency_ms integer,
    logical_engine character varying(32) NOT NULL,
    transport_provider character varying(32) NOT NULL,
    transport_model character varying(255) NOT NULL,
    created_at timestamp with time zone NOT NULL
);

CREATE TABLE public.provider_connections (
    id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    label character varying(255) NOT NULL,
    transport_provider character varying(32) NOT NULL,
    base_url character varying(1024) NOT NULL,
    api_key_encrypted text NOT NULL,
    platform_credential_ref character varying(255) DEFAULT ''::character varying NOT NULL,
    active boolean NOT NULL,
    deactivation_reason character varying(64) DEFAULT ''::character varying NOT NULL,
    credential_source character varying(16) DEFAULT 'byok'::character varying NOT NULL,
    paused_at timestamp with time zone,
    pause_reason character varying(64) DEFAULT ''::character varying NOT NULL,
    pause_until timestamp with time zone,
    last_tested_at timestamp with time zone,
    last_test_status character varying(16) NOT NULL,
    credential_revision uuid NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL
);

CREATE TABLE public.provider_routes (
    id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    connection_id uuid NOT NULL,
    logical_engine character varying(32) NOT NULL,
    transport_provider character varying(32) NOT NULL,
    transport_model character varying(255) NOT NULL,
    is_default boolean NOT NULL,
    active boolean DEFAULT true NOT NULL,
    deactivation_reason character varying(64) DEFAULT ''::character varying NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL
);

CREATE TABLE public.query_evidence_rows (
    id uuid NOT NULL,
    snapshot_id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    project_id uuid NOT NULL,
    date date NOT NULL,
    normalized_query character varying(512) NOT NULL,
    observed_page_url character varying(2048) NOT NULL,
    site_url_id uuid,
    resolved_page_url character varying(2048) NOT NULL,
    resolution_outcome character varying(16) NOT NULL,
    resolution_candidates jsonb NOT NULL,
    property_ref character varying(512) NOT NULL,
    impressions integer NOT NULL,
    clicks integer NOT NULL,
    ctr double precision,
    "position" double precision,
    source_metric_row_id uuid NOT NULL,
    source_artifact_id uuid NOT NULL,
    importer_version character varying(64) NOT NULL,
    resolver_version character varying(32) NOT NULL,
    created_at timestamp with time zone NOT NULL
);

CREATE TABLE public.query_evidence_snapshots (
    id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    project_id uuid NOT NULL,
    window_start date NOT NULL,
    window_end date NOT NULL,
    source_hash character varying(64) NOT NULL,
    supersedes_snapshot_id uuid,
    state character varying(24) NOT NULL,
    source_metric_row_ids jsonb NOT NULL,
    source_artifact_ids jsonb NOT NULL,
    coverage jsonb NOT NULL,
    limitations jsonb NOT NULL,
    analyzer_version character varying(32) NOT NULL,
    resolver_version character varying(32) NOT NULL,
    created_at timestamp with time zone NOT NULL
);

CREATE TABLE public.queue_workspace_turns (
    id uuid NOT NULL,
    queue_name character varying(64) NOT NULL,
    workspace_id uuid NOT NULL,
    last_claimed_at timestamp with time zone,
    created_at timestamp with time zone NOT NULL
);

CREATE TABLE public.raw_response_artifacts (
    id uuid NOT NULL,
    audit_id uuid NOT NULL,
    task_id uuid NOT NULL,
    logical_engine character varying(32) NOT NULL,
    transport_provider character varying(32) NOT NULL,
    transport_model character varying(255) NOT NULL,
    answer_text text NOT NULL,
    search_used boolean NOT NULL,
    search_events jsonb,
    citations jsonb,
    retrieved_sources jsonb,
    provider_metadata jsonb,
    usage jsonb,
    finish_reason character varying(24) NOT NULL,
    raw_finish_reason character varying(64),
    latency_ms integer,
    created_at timestamp with time zone NOT NULL
);

CREATE TABLE public.referral_classifications (
    id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    project_id uuid NOT NULL,
    referral_event_id uuid NOT NULL,
    is_ai_referral boolean NOT NULL,
    ai_source character varying(32) NOT NULL,
    logical_engine character varying(32),
    matched_rule_id character varying(64) NOT NULL,
    match_signal character varying(16) NOT NULL,
    confidence character varying(16) NOT NULL,
    rule_version character varying(64) NOT NULL,
    analyzer_version character varying(64) NOT NULL,
    created_at timestamp with time zone NOT NULL
);

CREATE TABLE public.referral_events (
    id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    project_id uuid NOT NULL,
    source character varying(16) NOT NULL,
    import_id uuid NOT NULL,
    source_metric_row_id uuid,
    occurred_at timestamp with time zone NOT NULL,
    landing_url character varying(2048) NOT NULL,
    referrer_host character varying(512) NOT NULL,
    referrer_url character varying(2048) NOT NULL,
    utm_source character varying(512) NOT NULL,
    utm_medium character varying(512) NOT NULL,
    utm_campaign character varying(512) NOT NULL,
    user_agent character varying(128) NOT NULL,
    session_id_hash character varying(64) NOT NULL,
    raw jsonb,
    content_hash character varying(64) NOT NULL,
    sanitize_version character varying(64) NOT NULL,
    ingested_at timestamp with time zone NOT NULL
);

CREATE TABLE public.response_analyses (
    id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    audit_id uuid NOT NULL,
    task_id uuid NOT NULL,
    artifact_id uuid NOT NULL,
    analyzer_version character varying(32) NOT NULL,
    scoring_rule_version character varying(32) NOT NULL,
    logical_engine character varying(32) NOT NULL,
    transport_provider character varying(32) NOT NULL,
    transport_model character varying(255) NOT NULL,
    prompt_index integer NOT NULL,
    repetition integer NOT NULL,
    prompt_class character varying(32) NOT NULL,
    cohort character varying(32) DEFAULT 'core'::character varying NOT NULL,
    brand_mentioned boolean NOT NULL,
    brand_first_offset integer,
    owned_domain_cited boolean NOT NULL,
    owned_citation_count integer NOT NULL,
    unintended_domain_cited boolean NOT NULL,
    citation_count integer NOT NULL,
    search_used boolean NOT NULL,
    search_query_count integer NOT NULL,
    fanout_state character varying(32) DEFAULT 'no_search'::character varying NOT NULL,
    fanout_queries text[] DEFAULT '{}'::text[] NOT NULL,
    fanout_event_count integer DEFAULT 0 NOT NULL,
    fanout_event_source character varying(16) DEFAULT 'none'::character varying NOT NULL,
    fanout_projection_version character varying(32) DEFAULT 'fanout-1'::character varying NOT NULL,
    ads_parser_version character varying(32),
    avg_position double precision,
    score jsonb,
    entity_assessments jsonb NOT NULL,
    retrieval_observed boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone NOT NULL
);

CREATE TABLE public.retrieved_sources (
    id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    audit_id uuid NOT NULL,
    analysis_id uuid NOT NULL,
    artifact_id uuid NOT NULL,
    analyzer_version character varying(32) NOT NULL,
    ordinal integer NOT NULL,
    url text NOT NULL,
    title text NOT NULL,
    domain character varying(255) NOT NULL,
    is_owned boolean NOT NULL,
    canonical_url text,
    url_hash character varying(64),
    url_identity_method character varying(24),
    url_identity_version character varying(32),
    created_at timestamp with time zone NOT NULL
);

CREATE TABLE public.robots_snapshots (
    id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    project_id uuid NOT NULL,
    origin character varying(2048) NOT NULL,
    content_hash character varying(64) NOT NULL,
    body text NOT NULL,
    truncated boolean NOT NULL,
    status_code integer
);

CREATE TABLE public.search_intelligence_calls (
    id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    project_id uuid NOT NULL,
    run_id uuid NOT NULL,
    dataset_id uuid NOT NULL,
    request_key character varying(128) NOT NULL,
    sequence integer NOT NULL,
    status character varying(16) NOT NULL,
    endpoint character varying(255) NOT NULL,
    sanitized_request jsonb NOT NULL,
    sanitized_response jsonb,
    response_sha256 character varying(64) NOT NULL,
    provider_task_id character varying(255) NOT NULL,
    estimated_cost_usd numeric(20,8) NOT NULL,
    provider_reported_cost_usd numeric(20,8),
    error_code character varying(64) NOT NULL,
    error_detail text NOT NULL,
    dispatched_at timestamp with time zone,
    completed_at timestamp with time zone,
    created_at timestamp with time zone NOT NULL
);

CREATE TABLE public.search_intelligence_datasets (
    id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    project_id uuid NOT NULL,
    run_id uuid NOT NULL,
    parent_dataset_id uuid,
    dataset_kind character varying(32) NOT NULL,
    scope_hash character varying(64) NOT NULL,
    target_domain character varying(255) NOT NULL,
    target_hostname character varying(255) NOT NULL,
    target_origin character varying(1024) NOT NULL,
    comparison_origin character varying(1024) NOT NULL,
    location_code integer,
    language_code character varying(16) NOT NULL,
    status character varying(16) NOT NULL,
    coverage character varying(16) NOT NULL,
    requested_rows integer NOT NULL,
    raw_rows_received integer NOT NULL,
    unique_rows_saved integer NOT NULL,
    provider_total integer,
    truncated boolean NOT NULL,
    summary jsonb NOT NULL,
    provider_filters jsonb NOT NULL,
    parser_version character varying(32) NOT NULL,
    collection_started_at timestamp with time zone,
    collection_ended_at timestamp with time zone,
    published_at timestamp with time zone,
    created_at timestamp with time zone NOT NULL
);

CREATE TABLE public.search_intelligence_dispatch_attempts (
    id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    project_id uuid NOT NULL,
    call_id uuid NOT NULL,
    ordinal integer NOT NULL,
    phase character varying(16) NOT NULL,
    status character varying(24) NOT NULL,
    error_code character varying(64) NOT NULL,
    retry_after_seconds double precision,
    dispatched_at timestamp with time zone NOT NULL,
    completed_at timestamp with time zone
);

CREATE TABLE public.search_intelligence_rows (
    id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    project_id uuid NOT NULL,
    dataset_id uuid NOT NULL,
    call_id uuid,
    provider_row_key character varying(64) NOT NULL,
    row_kind character varying(32) NOT NULL,
    keyword character varying(2048) NOT NULL,
    domain character varying(512) NOT NULL,
    url character varying(4096) NOT NULL,
    search_volume integer,
    difficulty integer,
    intent character varying(32) NOT NULL,
    rank_group integer,
    owned_rank_group integer,
    etv numeric(20,8),
    backlinks integer,
    referring_main_domains integer,
    dataforseo_rank integer,
    auxiliary jsonb NOT NULL,
    created_at timestamp with time zone NOT NULL
);

CREATE TABLE public.search_intelligence_runs (
    id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    project_id uuid NOT NULL,
    analytics_task_id uuid,
    actor_user_id uuid NOT NULL,
    previous_run_id uuid,
    connection_id uuid NOT NULL,
    connection_revision uuid NOT NULL,
    account_identity character varying(64) NOT NULL,
    status character varying(24) NOT NULL,
    action character varying(32) NOT NULL,
    idempotency_key character varying(160) NOT NULL,
    frozen_scope jsonb NOT NULL,
    call_plan jsonb NOT NULL,
    reused_datasets jsonb NOT NULL,
    pricing_version character varying(64) NOT NULL,
    estimated_cost_usd numeric(20,8) NOT NULL,
    provider_reported_cost_usd numeric(20,8),
    planned_calls integer NOT NULL,
    completed_calls integer NOT NULL,
    planned_rows integer NOT NULL,
    received_rows integer NOT NULL,
    uncertain_calls integer NOT NULL,
    error_code character varying(64) NOT NULL,
    error_detail text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    confirmed_at timestamp with time zone,
    cancelled_at timestamp with time zone,
    completed_at timestamp with time zone,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    credential_source character varying(16) NOT NULL,
    estimated_credits integer,
    charged_credits integer,
    platform_call_id uuid,
    CONSTRAINT ck_si_runs_credential_source CHECK (((((credential_source)::text = 'byok'::text) AND (estimated_credits IS NULL) AND (charged_credits IS NULL) AND (platform_call_id IS NULL)) OR (((credential_source)::text = 'platform'::text) AND (estimated_credits >= 0) AND ((charged_credits IS NULL) OR ((charged_credits >= 0) AND (charged_credits <= estimated_credits))))))
);

CREATE TABLE public.security_events (
    id uuid NOT NULL,
    actor_id uuid,
    workspace_id uuid,
    target_id uuid,
    event character varying(64) NOT NULL,
    occurred_at timestamp with time zone NOT NULL
);

CREATE TABLE public.site_change_observations (
    id uuid NOT NULL,
    snapshot_id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    site_url_id uuid NOT NULL,
    normalized_url character varying(2048) NOT NULL,
    field character varying(32) NOT NULL,
    change_class character varying(32) NOT NULL,
    before_value jsonb,
    after_value jsonb,
    source_analysis_a_id uuid,
    source_analysis_b_id uuid,
    source_artifact_a_id uuid,
    source_artifact_b_id uuid,
    source_evaluation_a_id uuid,
    source_evaluation_b_id uuid,
    expected boolean NOT NULL,
    implementation_event_id uuid,
    created_at timestamp with time zone NOT NULL,
    CONSTRAINT ck_site_change_observation_class CHECK (((change_class)::text = ANY ((ARRAY['improvement'::character varying, 'neutral-change'::character varying, 'potential-regression'::character varying, 'critical-regression'::character varying])::text[])))
);

CREATE TABLE public.site_change_snapshots (
    id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    project_id uuid NOT NULL,
    crawl_a_id uuid,
    crawl_b_id uuid NOT NULL,
    supersedes_id uuid,
    state character varying(24) NOT NULL,
    reason_code character varying(64),
    root_origin character varying(512) NOT NULL,
    crawl_scope_hash character varying(64) NOT NULL,
    source_hash character varying(64) NOT NULL,
    source_analysis_ids uuid[] NOT NULL,
    source_artifact_ids uuid[] NOT NULL,
    analyzer_version character varying(32) NOT NULL,
    page_analyzer_version character varying(32) NOT NULL,
    extractor_version character varying(32) NOT NULL,
    complete_pair boolean NOT NULL,
    coverage jsonb NOT NULL,
    summary jsonb NOT NULL,
    limitations text[] NOT NULL,
    created_at timestamp with time zone NOT NULL
);

CREATE TABLE public.site_crawl_events (
    id uuid NOT NULL,
    crawl_id uuid NOT NULL,
    event_type character varying(48) NOT NULL,
    message text NOT NULL,
    payload jsonb,
    created_at timestamp with time zone NOT NULL
);

CREATE TABLE public.site_crawl_tasks (
    id uuid NOT NULL,
    crawl_id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    site_url_id uuid,
    task_kind character varying(16) NOT NULL,
    requested_url character varying(2048) NOT NULL,
    url_hash character varying(64) NOT NULL,
    parent_site_url_id uuid,
    source_task_id uuid,
    depth integer NOT NULL,
    generation integer NOT NULL,
    idempotency_key character varying(160) NOT NULL,
    status character varying(24) NOT NULL,
    priority integer NOT NULL,
    randomized_position integer NOT NULL,
    available_at timestamp with time zone NOT NULL,
    lease_owner character varying(64),
    lease_expires_at timestamp with time zone,
    heartbeat_at timestamp with time zone,
    attempt_count integer NOT NULL,
    max_attempts integer NOT NULL,
    conflict_count integer NOT NULL,
    result_artifact_id uuid,
    classification_expected boolean NOT NULL,
    error_code character varying(32) NOT NULL,
    error_detail text NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    completed_at timestamp with time zone
);

CREATE TABLE public.site_crawls (
    id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    project_id uuid NOT NULL,
    profile_id uuid NOT NULL,
    status character varying(24) NOT NULL,
    discovery_status character varying(24) NOT NULL,
    analysis_status character varying(24) NOT NULL,
    root_url character varying(2048) NOT NULL,
    random_seed character varying(32) NOT NULL,
    configuration jsonb,
    sample_mode boolean NOT NULL,
    admitted_url_count integer NOT NULL,
    discovered_url_count integer NOT NULL,
    analyzed_url_count integer NOT NULL,
    failed_url_count integer NOT NULL,
    discovery_requested_count integer NOT NULL,
    analysis_requested_count integer NOT NULL,
    inventory_complete boolean NOT NULL,
    partial_reason character varying(48) NOT NULL,
    score_summary jsonb,
    site_facts jsonb,
    robots_snapshot_id uuid,
    robots_observed_at timestamp with time zone,
    extractor_version character varying(32) NOT NULL,
    analyzer_version character varying(32) NOT NULL,
    rule_catalog_version character varying(32) NOT NULL,
    scoring_version character varying(32) NOT NULL,
    error_message text NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    started_at timestamp with time zone,
    completed_at timestamp with time zone
);

CREATE TABLE public.site_discovery_frontier (
    id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    crawl_id uuid NOT NULL,
    normalized_url character varying(2048) NOT NULL,
    url_hash character varying(64) NOT NULL,
    depth integer NOT NULL,
    source_kind character varying(16) NOT NULL,
    value_kind character varying(32) NOT NULL,
    value_priority integer NOT NULL,
    parent_position integer NOT NULL,
    link_ordinal integer NOT NULL,
    referrer_site_url_ids uuid[] NOT NULL,
    rewrite_reason character varying(64) NOT NULL,
    rewrite_version character varying(32) NOT NULL,
    status character varying(16) NOT NULL,
    created_at timestamp with time zone NOT NULL,
    admitted_at timestamp with time zone
);

CREATE TABLE public.site_fetch_artifacts (
    id uuid NOT NULL,
    task_id uuid NOT NULL,
    crawl_id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    fetch_purpose character varying(16) NOT NULL,
    requested_url character varying(2048) NOT NULL,
    final_url character varying(2048) NOT NULL,
    redirect_chain jsonb,
    status_code integer,
    redacted_headers jsonb,
    content_type character varying(128) NOT NULL,
    content_hash character varying(64) NOT NULL,
    http_version character varying(16) NOT NULL,
    ttfb_ms integer,
    latency_ms integer,
    wire_bytes integer,
    decoded_bytes integer,
    acquisition_transport character varying(32) NOT NULL,
    acquisition_rung integer,
    acquisition_trigger character varying(32) NOT NULL,
    impersonation_profile character varying(64) NOT NULL,
    acquisition_options jsonb,
    acquisition_policy_version character varying(32) NOT NULL,
    extractor_version character varying(32) NOT NULL,
    normalized_facts jsonb,
    fetched_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone NOT NULL
);

CREATE TABLE public.site_fetch_attempts (
    id uuid NOT NULL,
    task_id uuid NOT NULL,
    crawl_id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    attempt_number integer NOT NULL,
    request_ordinal integer NOT NULL,
    method character varying(8) NOT NULL,
    target_host character varying(255) NOT NULL,
    outcome character varying(16) NOT NULL,
    error_code character varying(32) NOT NULL,
    status_code integer,
    latency_ms integer,
    wire_bytes integer,
    decoded_bytes integer,
    acquisition_transport character varying(32) NOT NULL,
    acquisition_rung integer,
    acquisition_trigger character varying(32) NOT NULL,
    impersonation_profile character varying(64) NOT NULL,
    acquisition_options jsonb,
    acquisition_policy_version character varying(32) NOT NULL,
    artifact_id uuid,
    created_at timestamp with time zone NOT NULL
);

CREATE TABLE public.site_health_profiles (
    id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    project_id uuid NOT NULL,
    root_url character varying(2048) NOT NULL,
    root_host character varying(255) NOT NULL,
    registrable_domain character varying(255) NOT NULL,
    include_globs jsonb,
    exclude_globs jsonb,
    selection_version integer NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL
);

CREATE TABLE public.site_health_snapshots (
    id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    project_id uuid NOT NULL,
    crawl_id uuid NOT NULL,
    selected_url_count integer NOT NULL,
    analyzed_url_count integer NOT NULL,
    web_fundamentals_score double precision,
    web_fundamentals_coverage double precision,
    web_fundamentals_state character varying(24) NOT NULL,
    aeo_readiness_score double precision,
    aeo_measurement_coverage double precision,
    aeo_measurement_state character varying(24) NOT NULL,
    classified_page_count integer NOT NULL,
    other_page_count integer NOT NULL,
    classification_error_page_count integer NOT NULL,
    classification_expected_page_count integer NOT NULL,
    classification_coverage double precision,
    classification_state character varying(24) NOT NULL,
    classification_reason_groups jsonb,
    classification_formula_version character varying(32) NOT NULL,
    scored_page_kind_set character varying[],
    scored_page_count_by_kind jsonb,
    readiness_dimensions jsonb,
    aeo_readiness_diagnostic jsonb NOT NULL,
    search_eligibility character varying(16) NOT NULL,
    eligibility_totals jsonb,
    eligibility_reasons jsonb,
    status_counts jsonb,
    top_issues jsonb,
    web_fundamentals jsonb,
    trend jsonb,
    change_summary jsonb,
    issue_count integer NOT NULL,
    technical_defect_count integer NOT NULL,
    technical_defect_affected_page_count integer NOT NULL,
    aeo_readiness_gap_count integer NOT NULL,
    aeo_readiness_gap_affected_page_count integer NOT NULL,
    severity_counts jsonb,
    category_counts jsonb,
    coverage_state character varying(16) NOT NULL,
    coverage_evidence jsonb,
    coverage_formula_version character varying(32) NOT NULL,
    source_analysis_ids uuid[],
    source_artifact_ids uuid[],
    source_evaluation_ids uuid[],
    source_task_ids uuid[],
    source_attempt_ids uuid[],
    classification_source_analysis_ids uuid[],
    classification_source_artifact_ids uuid[],
    classification_source_task_ids uuid[],
    analyzer_version character varying(32) NOT NULL,
    scoring_version character varying(32) NOT NULL,
    profile_version character varying(32) NOT NULL,
    schema_contract_version character varying(32) NOT NULL,
    presentation_version character varying(32) NOT NULL,
    created_at timestamp with time zone NOT NULL
);

CREATE TABLE public.site_internal_link_events (
    id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    project_id uuid NOT NULL,
    run_id uuid NOT NULL,
    candidate_id uuid NOT NULL,
    kind character varying(24) NOT NULL,
    evidence jsonb NOT NULL,
    created_at timestamp with time zone NOT NULL
);

CREATE TABLE public.site_internal_link_runs (
    id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    project_id uuid NOT NULL,
    crawl_id uuid NOT NULL,
    actor_id uuid NOT NULL,
    idempotency_key character varying(36) NOT NULL,
    state character varying(24) NOT NULL,
    policy_version integer NOT NULL,
    manifest jsonb NOT NULL,
    result jsonb,
    created_at timestamp with time zone NOT NULL
);

CREATE TABLE public.site_issues (
    id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    project_id uuid NOT NULL,
    crawl_id uuid NOT NULL,
    site_url_id uuid NOT NULL,
    analysis_id uuid NOT NULL,
    evaluation_id uuid NOT NULL,
    source_artifact_id uuid NOT NULL,
    rule_id character varying(64) NOT NULL,
    dimension character varying(16) NOT NULL,
    category character varying(32) NOT NULL,
    severity character varying(16) NOT NULL,
    finding_class character varying(16) NOT NULL,
    evidence jsonb,
    description text NOT NULL,
    remediation text NOT NULL,
    analyzer_version character varying(32) NOT NULL,
    rule_version character varying(32) NOT NULL,
    created_at timestamp with time zone NOT NULL
);

CREATE TABLE public.site_observed_architectures (
    id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    project_id uuid NOT NULL,
    crawl_id uuid NOT NULL,
    source_snapshot_id uuid NOT NULL,
    source_brand_profile_id uuid,
    coverage_state character varying(16) NOT NULL,
    page_count integer NOT NULL,
    page_kinds jsonb,
    internal_linking jsonb,
    structure_depth jsonb,
    hierarchy jsonb,
    archetype jsonb,
    source_analysis_ids uuid[],
    source_artifact_ids uuid[],
    source_evaluation_ids uuid[],
    source_link_metric_ids uuid[],
    extractor_version character varying(32) NOT NULL,
    analyzer_version character varying(32) NOT NULL,
    rule_version character varying(32) NOT NULL,
    architecture_formula_version character varying(32) NOT NULL,
    archetype_policy_version character varying(32) NOT NULL,
    created_at timestamp with time zone NOT NULL
);

CREATE TABLE public.site_page_analyses (
    id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    project_id uuid NOT NULL,
    crawl_id uuid NOT NULL,
    site_url_id uuid NOT NULL,
    artifact_id uuid NOT NULL,
    status character varying(24) NOT NULL,
    web_fundamentals_score double precision,
    web_fundamentals_coverage double precision,
    web_fundamentals_state character varying(24) NOT NULL,
    technical_earned_weight double precision NOT NULL,
    technical_determinate_weight double precision NOT NULL,
    technical_expected_weight double precision NOT NULL,
    technical_critical_complete boolean NOT NULL,
    aeo_readiness_score double precision,
    aeo_measurement_coverage double precision,
    aeo_measurement_state character varying(24) NOT NULL,
    aeo_measurement_reason character varying(64) NOT NULL,
    expected_checkpoint_profile jsonb,
    readiness_dimensions jsonb,
    profile_version character varying(32) NOT NULL,
    schema_contract_version character varying(32) NOT NULL,
    presentation_version character varying(32) NOT NULL,
    main_content_indexable boolean,
    analyzer_version character varying(32) NOT NULL,
    scoring_version character varying(32) NOT NULL,
    page_kind character varying(24) NOT NULL,
    classifier_version character varying(32) NOT NULL,
    page_kind_evidence jsonb,
    page_traits character varying(32)[],
    traits_version character varying(32) NOT NULL,
    is_current boolean NOT NULL,
    supersedes_analysis_id uuid,
    source_evaluation_ids uuid[],
    source_artifact_ids uuid[],
    finalized_at timestamp with time zone,
    created_at timestamp with time zone NOT NULL
);

CREATE TABLE public.site_page_link_metrics (
    id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    project_id uuid NOT NULL,
    crawl_id uuid NOT NULL,
    site_url_id uuid NOT NULL,
    inbound_count integer NOT NULL,
    outbound_count integer NOT NULL,
    main_content_inbound_count integer NOT NULL,
    main_content_outbound_count integer NOT NULL,
    nofollow_inbound_count integer NOT NULL,
    depth_from_home integer,
    source_page_count integer NOT NULL,
    authority_share double precision NOT NULL,
    authority_rank integer NOT NULL,
    anchor_diagnostics jsonb,
    top_inbound jsonb,
    top_outbound jsonb,
    source_artifact_ids uuid[],
    extractor_version character varying(32) NOT NULL,
    formula_version character varying(32) NOT NULL,
    created_at timestamp with time zone NOT NULL
);

CREATE TABLE public.site_rule_evaluations (
    id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    analysis_id uuid NOT NULL,
    source_artifact_id uuid NOT NULL,
    source_architecture_id uuid,
    rule_id character varying(64) NOT NULL,
    dimension character varying(16) NOT NULL,
    category character varying(32) NOT NULL,
    severity character varying(16) NOT NULL,
    finding_class character varying(16) NOT NULL,
    scope character varying(16) NOT NULL,
    weight double precision NOT NULL,
    outcome character varying(16) NOT NULL,
    display_applicability boolean NOT NULL,
    score_applicability boolean NOT NULL,
    reason_code character varying(64) NOT NULL,
    score_roles character varying(32)[],
    readiness_dimension character varying(32) NOT NULL,
    readiness_weight double precision NOT NULL,
    evidence jsonb,
    supporting_artifact_ids uuid[],
    extractor_version character varying(32) NOT NULL,
    analyzer_version character varying(32) NOT NULL,
    rule_version character varying(32) NOT NULL,
    created_at timestamp with time zone NOT NULL,
    CONSTRAINT ck_site_rule_evaluations_outcome CHECK (((outcome)::text = ANY ((ARRAY['satisfied'::character varying, 'partial'::character varying, 'missing'::character varying, 'unknown'::character varying, 'unavailable'::character varying, 'conflicting'::character varying, 'error'::character varying, 'not_applicable'::character varying, 'excluded'::character varying])::text[]))),
    CONSTRAINT ck_site_rule_evaluations_scope CHECK (((scope)::text = ANY ((ARRAY['page'::character varying, 'site'::character varying, 'cluster'::character varying, 'graph'::character varying])::text[])))
);

CREATE TABLE public.site_url_observations (
    id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    project_id uuid NOT NULL,
    crawl_id uuid NOT NULL,
    site_url_id uuid NOT NULL,
    source_kind character varying(16) NOT NULL,
    parent_site_url_id uuid,
    source_artifact_id uuid,
    value_kind character varying(32) NOT NULL,
    value_priority integer NOT NULL,
    depth integer NOT NULL,
    observed_url character varying(2048) NOT NULL,
    final_url character varying(2048) NOT NULL,
    status_code integer,
    content_type character varying(128) NOT NULL,
    title character varying(1024) NOT NULL,
    rewrite_reason character varying(64) NOT NULL,
    rewrite_version character varying(32) NOT NULL,
    created_at timestamp with time zone NOT NULL
);

CREATE TABLE public.site_urls (
    id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    project_id uuid NOT NULL,
    normalized_url character varying(2048) NOT NULL,
    url_hash character varying(64) NOT NULL,
    display_url character varying(2048) NOT NULL,
    host character varying(255) NOT NULL,
    depth integer NOT NULL,
    corpus_disposition character varying(16) NOT NULL,
    disposition_reason character varying(32) NOT NULL,
    disposition_version character varying(32) NOT NULL,
    item_kind character varying(16) NOT NULL,
    discovery_status character varying(24) NOT NULL,
    latest_source_kind character varying(16) NOT NULL,
    latest_title character varying(1024) NOT NULL,
    latest_content_type character varying(128) NOT NULL,
    first_seen_crawl_id uuid,
    last_seen_crawl_id uuid,
    first_seen_at timestamp with time zone NOT NULL,
    last_seen_at timestamp with time zone NOT NULL
);

CREATE TABLE public.source_page_entity_presences (
    id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    project_id uuid NOT NULL,
    source_page_id uuid NOT NULL,
    snapshot_id uuid NOT NULL,
    entity_kind character varying(16) NOT NULL,
    entity_name character varying(255) NOT NULL,
    presence character varying(24) NOT NULL,
    match_method character varying(24) NOT NULL,
    match_count integer NOT NULL,
    first_offset integer,
    passage_refs jsonb,
    roster_version character varying(64) NOT NULL,
    detector_version character varying(32),
    created_at timestamp with time zone NOT NULL
);

CREATE TABLE public.source_page_inspection_spend (
    id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    project_id uuid NOT NULL,
    source_page_id uuid,
    spend_kind character varying(16) NOT NULL,
    units double precision NOT NULL,
    idempotency_key character varying(200) NOT NULL,
    created_at timestamp with time zone NOT NULL
);

CREATE TABLE public.source_page_snapshots (
    id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    project_id uuid NOT NULL,
    source_page_id uuid NOT NULL,
    audit_id uuid,
    requested_url text NOT NULL,
    final_url text NOT NULL,
    redirect_chain jsonb,
    status_code integer,
    content_type character varying(128),
    charset character varying(32),
    body_bytes integer NOT NULL,
    content_hash character varying(64),
    redacted_headers jsonb,
    page_facts jsonb,
    evidence_passages jsonb,
    extracted_chars integer NOT NULL,
    robots_state character varying(16),
    outcome character varying(24) NOT NULL,
    outcome_reason character varying(48),
    extractor_version character varying(32),
    inspector_version character varying(32),
    fetched_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone NOT NULL
);

CREATE TABLE public.source_pages (
    id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    project_id uuid NOT NULL,
    url_hash character varying(64) NOT NULL,
    canonical_url text NOT NULL,
    registrable_domain character varying(255) NOT NULL,
    source_class character varying(48),
    source_taxonomy_version character varying(32),
    page_format character varying(32) NOT NULL,
    page_format_method character varying(24),
    page_format_version character varying(32),
    inspection_state character varying(24) NOT NULL,
    inspection_reason character varying(48),
    claim_expires_at timestamp with time zone,
    latest_snapshot_id uuid,
    content_hash character varying(64),
    last_inspected_at timestamp with time zone,
    last_cited_at timestamp with time zone,
    recurrence_count integer NOT NULL,
    first_seen_audit_id uuid,
    last_seen_audit_id uuid,
    inspector_version character varying(32),
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL
);

CREATE TABLE public.topics (
    id uuid NOT NULL,
    project_id uuid NOT NULL,
    parent_id uuid,
    name character varying(255) NOT NULL,
    description character varying(1024) NOT NULL,
    origin character varying(32) NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL
);

CREATE TABLE public.traffic_page_stats (
    id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    project_id uuid NOT NULL,
    snapshot_id uuid NOT NULL,
    site_url_id uuid,
    canonical_url character varying(2048) NOT NULL,
    metrics jsonb,
    source_metric_row_ids jsonb,
    source_artifact_ids jsonb,
    created_at timestamp with time zone NOT NULL
);

CREATE TABLE public.traffic_query_stats (
    id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    project_id uuid NOT NULL,
    snapshot_id uuid NOT NULL,
    normalized_query character varying(1024) NOT NULL,
    metrics jsonb,
    source_metric_row_ids jsonb,
    source_artifact_ids jsonb,
    created_at timestamp with time zone NOT NULL
);

CREATE TABLE public.traffic_snapshots (
    id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    project_id uuid NOT NULL,
    window_start date NOT NULL,
    window_end date NOT NULL,
    granularity character varying(8) NOT NULL,
    preset_window_days integer,
    metrics jsonb,
    dimension_counts jsonb,
    coverage jsonb,
    source_metric_row_ids jsonb,
    source_artifact_ids jsonb,
    formula_version character varying(64) NOT NULL,
    normalization_version character varying(64) NOT NULL,
    created_at timestamp with time zone NOT NULL
);

CREATE TABLE public.unintended_domains (
    id uuid NOT NULL,
    project_id uuid NOT NULL,
    domain character varying(255) NOT NULL,
    created_at timestamp with time zone NOT NULL
);

CREATE TABLE public.usage_windows (
    id uuid NOT NULL,
    subject_kind character varying(32) NOT NULL,
    subject_hash character varying(64) NOT NULL,
    operation character varying(64) NOT NULL,
    window_started_at timestamp with time zone NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    count integer NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL
);

CREATE TABLE public.user_identities (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    provider character varying(20) NOT NULL,
    subject character varying(255) NOT NULL,
    email character varying(255) NOT NULL,
    email_verified boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL
);

CREATE TABLE public.users (
    id uuid NOT NULL,
    email character varying(255) NOT NULL,
    hashed_password character varying(255),
    registration_origin character varying(24) NOT NULL,
    email_verified_at timestamp with time zone,
    email_verification_method character varying(24),
    role character varying(20) NOT NULL,
    is_active boolean NOT NULL,
    session_version integer NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    CONSTRAINT ck_user_registration_origin CHECK (((registration_origin)::text = ANY ((ARRAY['public'::character varying, 'operator'::character varying])::text[])))
);

CREATE TABLE public.web_acquisition_controls (
    domain character varying(255) NOT NULL,
    blocked boolean NOT NULL,
    actor_id uuid NOT NULL,
    reason character varying(255) NOT NULL,
    updated_at timestamp with time zone NOT NULL
);

CREATE TABLE public.workspace_invitations (
    id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    email_normalized character varying(255) NOT NULL,
    role character varying(20) NOT NULL,
    token_sha256 character varying(64) NOT NULL,
    invited_by_user_id uuid,
    expires_at timestamp with time zone NOT NULL,
    accepted_at timestamp with time zone,
    accepted_by_user_id uuid,
    revoked_at timestamp with time zone,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    CONSTRAINT ck_workspace_invitation_role CHECK (((role)::text = ANY ((ARRAY['admin'::character varying, 'member'::character varying, 'viewer'::character varying])::text[])))
);

CREATE TABLE public.workspace_members (
    id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    user_id uuid NOT NULL,
    role character varying(20) NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    CONSTRAINT ck_workspace_member_role CHECK (((role)::text = ANY ((ARRAY['owner'::character varying, 'admin'::character varying, 'member'::character varying, 'viewer'::character varying])::text[])))
);

CREATE TABLE public.workspace_site_health_runtime (
    id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    resolved_registry_revision character varying(64) NOT NULL,
    resolved_entitlement_lifecycle_version integer NOT NULL,
    resolved_valid_until timestamp with time zone,
    discovery_mode character varying(16) NOT NULL,
    discovery_url_cap integer,
    sample_url_limit integer NOT NULL,
    monitored_url_limit integer NOT NULL,
    count_disclosure boolean NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL
);

CREATE TABLE public.workspaces (
    id uuid NOT NULL,
    name character varying(255) NOT NULL,
    is_system boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL
);

ALTER TABLE ONLY public.account_grants
    ADD CONSTRAINT account_grants_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.account_policy_acceptances
    ADD CONSTRAINT account_policy_acceptances_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.action_status_events
    ADD CONSTRAINT action_status_events_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.actions
    ADD CONSTRAINT actions_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.agent_chats
    ADD CONSTRAINT agent_chats_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.agent_instruction_revisions
    ADD CONSTRAINT agent_instruction_revisions_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.agent_messages
    ADD CONSTRAINT agent_messages_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.agent_model_attempts
    ADD CONSTRAINT agent_model_attempts_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.agent_output_revisions
    ADD CONSTRAINT agent_output_revisions_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.agent_outputs
    ADD CONSTRAINT agent_outputs_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.agent_runs
    ADD CONSTRAINT agent_runs_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.agent_run_transcripts
    ADD CONSTRAINT agent_run_transcripts_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.agent_tool_attempts
    ADD CONSTRAINT agent_tool_attempts_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.ai_referral_landing_daily
    ADD CONSTRAINT ai_referral_landing_daily_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.ai_referrals_snapshots
    ADD CONSTRAINT ai_referrals_snapshots_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.ai_traffic_insights
    ADD CONSTRAINT ai_traffic_insights_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.aio_entity_links
    ADD CONSTRAINT aio_entity_links_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.aio_observations
    ADD CONSTRAINT aio_observations_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.analytics_tasks
    ADD CONSTRAINT analytics_tasks_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.answer_ad_observations
    ADD CONSTRAINT answer_ad_observations_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.answer_perceptions
    ADD CONSTRAINT answer_perceptions_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.answer_claims
    ADD CONSTRAINT answer_claims_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.brand_facts
    ADD CONSTRAINT brand_facts_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.brand_fact_revisions
    ADD CONSTRAINT brand_fact_revisions_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.claim_verdicts
    ADD CONSTRAINT claim_verdicts_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.fact_verifications
    ADD CONSTRAINT fact_verifications_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.api_idempotency
    ADD CONSTRAINT api_idempotency_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.api_idempotency
    ADD CONSTRAINT uq_api_idempotency_key UNIQUE (api_key_id, idempotency_key);

ALTER TABLE ONLY public.api_keys
    ADD CONSTRAINT api_keys_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.api_keys
    ADD CONSTRAINT uq_api_keys_prefix UNIQUE (prefix);

ALTER TABLE ONLY public.api_keys
    ADD CONSTRAINT uq_api_keys_ws_id UNIQUE (workspace_id, id);

ALTER TABLE ONLY public.entity_sentiments
    ADD CONSTRAINT entity_sentiments_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.audit_engine_snapshots
    ADD CONSTRAINT audit_engine_snapshots_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.audit_events
    ADD CONSTRAINT audit_events_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.audit_prompt_snapshots
    ADD CONSTRAINT audit_prompt_snapshots_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.audit_schedules
    ADD CONSTRAINT audit_schedules_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.audit_tasks
    ADD CONSTRAINT audit_tasks_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.audits
    ADD CONSTRAINT audits_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.auth_challenges
    ADD CONSTRAINT auth_challenges_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.auth_challenges
    ADD CONSTRAINT auth_challenges_token_digest_key UNIQUE (token_digest);

ALTER TABLE ONLY public.billing_accounts
    ADD CONSTRAINT billing_accounts_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.billing_catalog_revisions
    ADD CONSTRAINT billing_catalog_revisions_created_idempotency_key_key UNIQUE (created_idempotency_key);

ALTER TABLE ONLY public.billing_catalog_revisions
    ADD CONSTRAINT billing_catalog_revisions_payload_sha256_key UNIQUE (payload_sha256);

ALTER TABLE ONLY public.billing_catalog_revisions
    ADD CONSTRAINT billing_catalog_revisions_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.billing_catalog_revisions
    ADD CONSTRAINT billing_catalog_revisions_published_idempotency_key_key UNIQUE (published_idempotency_key);

ALTER TABLE ONLY public.billing_catalog_revisions
    ADD CONSTRAINT billing_catalog_revisions_revision_key UNIQUE (revision);

ALTER TABLE ONLY public.billing_invoice_counters
    ADD CONSTRAINT billing_invoice_counters_pkey PRIMARY KEY (financial_year);

ALTER TABLE ONLY public.billing_invoices
    ADD CONSTRAINT billing_invoices_invoice_number_key UNIQUE (invoice_number);

ALTER TABLE ONLY public.billing_invoices
    ADD CONSTRAINT billing_invoices_payment_id_key UNIQUE (payment_id);

ALTER TABLE ONLY public.billing_invoices
    ADD CONSTRAINT billing_invoices_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.billing_invoices
    ADD CONSTRAINT billing_invoices_receipt_number_key UNIQUE (receipt_number);

ALTER TABLE ONLY public.billing_payments
    ADD CONSTRAINT billing_payments_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.billing_subscriptions
    ADD CONSTRAINT billing_subscriptions_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.billing_webhook_events
    ADD CONSTRAINT billing_webhook_events_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.bot_activity_daily
    ADD CONSTRAINT bot_activity_daily_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.bot_ip_range_snapshots
    ADD CONSTRAINT bot_ip_range_snapshots_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.bot_requests
    ADD CONSTRAINT bot_requests_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.brand_aliases
    ADD CONSTRAINT brand_aliases_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.brand_discoveries
    ADD CONSTRAINT brand_discoveries_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.brand_discovery_tasks
    ADD CONSTRAINT brand_discovery_tasks_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.brand_logo_assets
    ADD CONSTRAINT brand_logo_assets_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.brand_mentions
    ADD CONSTRAINT brand_mentions_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.brand_profiles
    ADD CONSTRAINT brand_profiles_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.brand_research_snapshots
    ADD CONSTRAINT brand_research_snapshots_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.branded_query_overrides
    ADD CONSTRAINT branded_query_overrides_ordinal_key UNIQUE (ordinal);

ALTER TABLE ONLY public.branded_query_overrides
    ADD CONSTRAINT branded_query_overrides_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.brands
    ADD CONSTRAINT brands_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.citations
    ADD CONSTRAINT citations_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.commerce_categories
    ADD CONSTRAINT commerce_categories_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.commerce_competitor_attempts
    ADD CONSTRAINT commerce_competitor_attempts_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.commerce_competitor_candidates
    ADD CONSTRAINT commerce_competitor_candidates_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.commerce_csv_imports
    ADD CONSTRAINT commerce_csv_imports_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.commerce_observation_citations
    ADD CONSTRAINT commerce_observation_citations_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.commerce_product_categories
    ADD CONSTRAINT commerce_product_categories_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.commerce_product_observations
    ADD CONSTRAINT commerce_product_observations_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.commerce_products
    ADD CONSTRAINT commerce_products_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.commerce_prompt_targets
    ADD CONSTRAINT commerce_prompt_targets_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.commerce_recommendation_observations
    ADD CONSTRAINT commerce_recommendation_observations_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.commerce_shelf_snapshots
    ADD CONSTRAINT commerce_shelf_snapshots_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.competitor_mentions
    ADD CONSTRAINT competitor_mentions_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.competitors
    ADD CONSTRAINT competitors_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.consumable_ledger
    ADD CONSTRAINT consumable_ledger_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.content_differentiation_candidates
    ADD CONSTRAINT content_differentiation_candidates_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.content_differentiation_reports
    ADD CONSTRAINT content_differentiation_reports_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.crawl_log_batches
    ADD CONSTRAINT crawl_log_batches_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.crawl_log_coverage_daily
    ADD CONSTRAINT crawl_log_coverage_daily_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.crawl_log_sources
    ADD CONSTRAINT crawl_log_sources_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.crawl_log_states
    ADD CONSTRAINT crawl_log_states_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.crawl_log_uploads
    ADD CONSTRAINT crawl_log_uploads_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.demand_signals
    ADD CONSTRAINT demand_signals_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.demand_snapshots
    ADD CONSTRAINT demand_snapshots_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.enterprise_agreement_references
    ADD CONSTRAINT enterprise_agreement_references_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.execution_cost_projections
    ADD CONSTRAINT execution_cost_projections_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.grant_revocations
    ADD CONSTRAINT grant_revocations_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.idempotency_records
    ADD CONSTRAINT idempotency_records_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.integration_connections
    ADD CONSTRAINT integration_connections_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.integration_events
    ADD CONSTRAINT integration_events_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.integration_import_artifacts
    ADD CONSTRAINT integration_import_artifacts_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.integration_metric_rows
    ADD CONSTRAINT integration_metric_rows_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.integration_oauth_grants
    ADD CONSTRAINT integration_oauth_grants_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.integration_oauth_states
    ADD CONSTRAINT integration_oauth_states_jti_key UNIQUE (jti);

ALTER TABLE ONLY public.integration_oauth_states
    ADD CONSTRAINT integration_oauth_states_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.integration_property_mappings
    ADD CONSTRAINT integration_property_mappings_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.integration_sync_runs
    ADD CONSTRAINT integration_sync_runs_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.introductory_claims
    ADD CONSTRAINT introductory_claims_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.introductory_operator_codes
    ADD CONSTRAINT introductory_operator_codes_code_sha256_key UNIQUE (code_sha256);

ALTER TABLE ONLY public.introductory_operator_codes
    ADD CONSTRAINT introductory_operator_codes_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.mcp_authorization_codes
    ADD CONSTRAINT mcp_authorization_codes_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.mcp_authorization_requests
    ADD CONSTRAINT mcp_authorization_requests_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.mcp_confirmations
    ADD CONSTRAINT mcp_confirmations_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.mcp_oauth_clients
    ADD CONSTRAINT mcp_oauth_clients_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.mcp_oauth_grants
    ADD CONSTRAINT mcp_oauth_grants_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.metric_snapshots
    ADD CONSTRAINT metric_snapshots_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.monitored_site_urls
    ADD CONSTRAINT monitored_site_urls_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.observed_entity_candidates
    ADD CONSTRAINT observed_entity_candidates_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.opportunities
    ADD CONSTRAINT opportunities_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.opportunity_implementation_events
    ADD CONSTRAINT opportunity_implementation_events_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.opportunity_orders
    ADD CONSTRAINT opportunity_orders_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.opportunity_snapshots
    ADD CONSTRAINT opportunity_snapshots_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.opportunity_verification_events
    ADD CONSTRAINT opportunity_verification_events_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.overview_layouts
    ADD CONSTRAINT overview_layouts_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.owned_domains
    ADD CONSTRAINT owned_domains_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.project_markets
    ADD CONSTRAINT project_markets_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.project_markets
    ADD CONSTRAINT uq_project_markets_ws_project_id UNIQUE (workspace_id, project_id, id);

ALTER TABLE ONLY public.project_markets
    ADD CONSTRAINT uq_project_markets_market UNIQUE (project_id, country_code, language_code);

ALTER TABLE ONLY public.pending_activations
    ADD CONSTRAINT pending_activations_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.performance_dimension_stats
    ADD CONSTRAINT performance_dimension_stats_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.platform_calls
    ADD CONSTRAINT platform_calls_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.policy_acceptances
    ADD CONSTRAINT policy_acceptances_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.projects
    ADD CONSTRAINT projects_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.prompt_candidates
    ADD CONSTRAINT prompt_candidates_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.prompt_generation_runs
    ADD CONSTRAINT prompt_generation_runs_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.prompt_metric_snapshots
    ADD CONSTRAINT prompt_metric_snapshots_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.prompt_sets
    ADD CONSTRAINT prompt_sets_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.prompts
    ADD CONSTRAINT prompts_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.provider_attempts
    ADD CONSTRAINT provider_attempts_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.provider_capacity_buckets
    ADD CONSTRAINT provider_capacity_buckets_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.provider_capacity_leases
    ADD CONSTRAINT provider_capacity_leases_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.provider_connection_tests
    ADD CONSTRAINT provider_connection_tests_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.provider_connections
    ADD CONSTRAINT provider_connections_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.provider_routes
    ADD CONSTRAINT provider_routes_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.query_evidence_rows
    ADD CONSTRAINT query_evidence_rows_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.query_evidence_snapshots
    ADD CONSTRAINT query_evidence_snapshots_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.queue_workspace_turns
    ADD CONSTRAINT queue_workspace_turns_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.raw_response_artifacts
    ADD CONSTRAINT raw_response_artifacts_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.referral_classifications
    ADD CONSTRAINT referral_classifications_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.referral_events
    ADD CONSTRAINT referral_events_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.response_analyses
    ADD CONSTRAINT response_analyses_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.retrieved_sources
    ADD CONSTRAINT retrieved_sources_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.robots_snapshots
    ADD CONSTRAINT robots_snapshots_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.search_intelligence_calls
    ADD CONSTRAINT search_intelligence_calls_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.search_intelligence_datasets
    ADD CONSTRAINT search_intelligence_datasets_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.search_intelligence_dispatch_attempts
    ADD CONSTRAINT search_intelligence_dispatch_attempts_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.search_intelligence_rows
    ADD CONSTRAINT search_intelligence_rows_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.search_intelligence_runs
    ADD CONSTRAINT search_intelligence_runs_analytics_task_id_key UNIQUE (analytics_task_id);

ALTER TABLE ONLY public.search_intelligence_runs
    ADD CONSTRAINT search_intelligence_runs_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.security_events
    ADD CONSTRAINT security_events_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.site_change_observations
    ADD CONSTRAINT site_change_observations_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.site_change_snapshots
    ADD CONSTRAINT site_change_snapshots_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.site_crawl_events
    ADD CONSTRAINT site_crawl_events_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.site_crawl_tasks
    ADD CONSTRAINT site_crawl_tasks_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.site_crawls
    ADD CONSTRAINT site_crawls_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.site_discovery_frontier
    ADD CONSTRAINT site_discovery_frontier_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.site_fetch_artifacts
    ADD CONSTRAINT site_fetch_artifacts_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.site_fetch_attempts
    ADD CONSTRAINT site_fetch_attempts_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.site_health_profiles
    ADD CONSTRAINT site_health_profiles_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.site_health_snapshots
    ADD CONSTRAINT site_health_snapshots_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.site_internal_link_events
    ADD CONSTRAINT site_internal_link_events_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.site_internal_link_events
    ADD CONSTRAINT site_internal_link_events_run_id_candidate_id_kind_key UNIQUE (run_id, candidate_id, kind);

ALTER TABLE ONLY public.site_internal_link_runs
    ADD CONSTRAINT site_internal_link_runs_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.site_internal_link_runs
    ADD CONSTRAINT site_internal_link_runs_workspace_id_project_id_id_key UNIQUE (workspace_id, project_id, id);

ALTER TABLE ONLY public.site_internal_link_runs
    ADD CONSTRAINT site_internal_link_runs_workspace_id_project_id_idempotency_key UNIQUE (workspace_id, project_id, idempotency_key);

ALTER TABLE ONLY public.site_issues
    ADD CONSTRAINT site_issues_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.site_observed_architectures
    ADD CONSTRAINT site_observed_architectures_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.site_page_analyses
    ADD CONSTRAINT site_page_analyses_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.site_page_link_metrics
    ADD CONSTRAINT site_page_link_metrics_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.site_rule_evaluations
    ADD CONSTRAINT site_rule_evaluations_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.site_url_observations
    ADD CONSTRAINT site_url_observations_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.site_urls
    ADD CONSTRAINT site_urls_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.source_page_entity_presences
    ADD CONSTRAINT source_page_entity_presences_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.source_page_inspection_spend
    ADD CONSTRAINT source_page_inspection_spend_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.source_page_snapshots
    ADD CONSTRAINT source_page_snapshots_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.source_pages
    ADD CONSTRAINT source_pages_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.topics
    ADD CONSTRAINT topics_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.traffic_page_stats
    ADD CONSTRAINT traffic_page_stats_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.traffic_query_stats
    ADD CONSTRAINT traffic_query_stats_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.traffic_snapshots
    ADD CONSTRAINT traffic_snapshots_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.unintended_domains
    ADD CONSTRAINT unintended_domains_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.account_grants
    ADD CONSTRAINT uq_account_grant_bundle_key UNIQUE (billing_account_id, idempotency_key, key);

ALTER TABLE ONLY public.actions
    ADD CONSTRAINT uq_actions_project_group UNIQUE (project_id, group_key);

ALTER TABLE ONLY public.agent_instruction_revisions
    ADD CONSTRAINT uq_agent_instruction_revision UNIQUE (project_id, revision);

ALTER TABLE ONLY public.agent_messages
    ADD CONSTRAINT uq_agent_message_sequence UNIQUE (chat_id, sequence);

ALTER TABLE ONLY public.agent_model_attempts
    ADD CONSTRAINT uq_agent_model_attempt_dispatch UNIQUE (dispatch_id);

ALTER TABLE ONLY public.agent_model_attempts
    ADD CONSTRAINT uq_agent_model_attempt_slot UNIQUE (run_id, run_attempt, ordinal);

ALTER TABLE ONLY public.agent_outputs
    ADD CONSTRAINT uq_agent_output_chat UNIQUE (chat_id);

ALTER TABLE ONLY public.agent_output_revisions
    ADD CONSTRAINT uq_agent_output_revision_number UNIQUE (output_id, number);

ALTER TABLE ONLY public.agent_runs
    ADD CONSTRAINT uq_agent_run_ws_idempotency UNIQUE (workspace_id, idempotency_key);

ALTER TABLE ONLY public.agent_run_transcripts
    ADD CONSTRAINT uq_agent_run_transcript_run UNIQUE (run_id);

ALTER TABLE ONLY public.agent_tool_attempts
    ADD CONSTRAINT uq_agent_tool_attempt_slot UNIQUE (run_id, run_attempt, ordinal, call_id);

ALTER TABLE ONLY public.ai_referral_landing_daily
    ADD CONSTRAINT uq_ai_referral_landing_grain UNIQUE (workspace_id, project_id, reporting_date, reporting_timezone, url_hash, ai_source);

ALTER TABLE ONLY public.ai_referrals_snapshots
    ADD CONSTRAINT uq_ai_referrals_snapshot_window UNIQUE (project_id, window_start, window_end, granularity);

ALTER TABLE ONLY public.ai_traffic_insights
    ADD CONSTRAINT uq_ai_traffic_insights_window UNIQUE (workspace_id, project_id, window_start, window_end);

ALTER TABLE ONLY public.aio_entity_links
    ADD CONSTRAINT uq_aio_entity_link_observation_url UNIQUE (observation_id, url);

ALTER TABLE ONLY public.aio_observations
    ADD CONSTRAINT uq_aio_observation_task UNIQUE (task_id);

ALTER TABLE ONLY public.analytics_tasks
    ADD CONSTRAINT uq_analytics_task_idempotency_key UNIQUE (idempotency_key);

ALTER TABLE ONLY public.answer_ad_observations
    ADD CONSTRAINT uq_answer_ad_observation_artifact_rank UNIQUE (artifact_id, parser_version, rank_absolute);

ALTER TABLE ONLY public.answer_perceptions
    ADD CONSTRAINT uq_answer_perception_analysis_extractor UNIQUE (analysis_id, extractor_version);

ALTER TABLE ONLY public.answer_perceptions
    ADD CONSTRAINT uq_answer_perceptions_ws_id UNIQUE (workspace_id, id);

ALTER TABLE ONLY public.entity_sentiments
    ADD CONSTRAINT uq_entity_sentiment_perception_entity UNIQUE (perception_id, entity_id);

ALTER TABLE ONLY public.answer_claims
    ADD CONSTRAINT uq_answer_claim_perception_ordinal UNIQUE (perception_id, ordinal);

ALTER TABLE ONLY public.answer_claims
    ADD CONSTRAINT uq_answer_claims_ws_id UNIQUE (workspace_id, id);

ALTER TABLE ONLY public.brand_facts
    ADD CONSTRAINT uq_brand_facts_ws_id UNIQUE (workspace_id, id);

ALTER TABLE ONLY public.brand_fact_revisions
    ADD CONSTRAINT uq_brand_fact_revision_fact_revision UNIQUE (fact_id, revision);

ALTER TABLE ONLY public.claim_verdicts
    ADD CONSTRAINT uq_claim_verdict_verification_claim UNIQUE (verification_id, claim_id);

ALTER TABLE ONLY public.fact_verifications
    ADD CONSTRAINT uq_fact_verification_perception_template UNIQUE (perception_id, verify_template_version);

ALTER TABLE ONLY public.fact_verifications
    ADD CONSTRAINT uq_fact_verifications_ws_id UNIQUE (workspace_id, id);

ALTER TABLE ONLY public.audit_engine_snapshots
    ADD CONSTRAINT uq_audit_engine_snapshot_engine UNIQUE (audit_id, logical_engine);

ALTER TABLE ONLY public.audits
    ADD CONSTRAINT uq_audit_parent_repair_key UNIQUE (parent_audit_id, repair_key);

ALTER TABLE ONLY public.audit_prompt_snapshots
    ADD CONSTRAINT uq_audit_prompt_snapshot_index UNIQUE (audit_id, prompt_index);

ALTER TABLE ONLY public.audit_tasks
    ADD CONSTRAINT uq_audit_task_idempotency_key UNIQUE (idempotency_key);

ALTER TABLE ONLY public.audit_tasks
    ADD CONSTRAINT uq_audit_task_slot UNIQUE (audit_id, prompt_index, repetition, logical_engine);

ALTER TABLE ONLY public.audit_tasks
    ADD CONSTRAINT uq_audit_tasks_ws_project_audit_id UNIQUE (workspace_id, project_id, audit_id, id);

ALTER TABLE ONLY public.audits
    ADD CONSTRAINT uq_audits_ws_project_id UNIQUE (workspace_id, project_id, id);

ALTER TABLE ONLY public.auth_challenges
    ADD CONSTRAINT uq_auth_challenge_purpose UNIQUE (user_id, purpose);

ALTER TABLE ONLY public.billing_subscriptions
    ADD CONSTRAINT uq_billing_subscription_external UNIQUE (provider, provider_mode, external_subscription_id);

ALTER TABLE ONLY public.billing_webhook_events
    ADD CONSTRAINT uq_billing_webhook_external UNIQUE (provider, provider_mode, external_event_id);

ALTER TABLE ONLY public.bot_activity_daily
    ADD CONSTRAINT uq_bot_activity_daily_scope UNIQUE (workspace_id, project_id, id);

ALTER TABLE ONLY public.bot_activity_daily
    ADD CONSTRAINT uq_bot_activity_grain UNIQUE (workspace_id, project_id, reporting_date, reporting_timezone, bot_id, identity_key, verification, status_code);

ALTER TABLE ONLY public.bot_requests
    ADD CONSTRAINT uq_bot_requests_scope UNIQUE (workspace_id, project_id, id);

ALTER TABLE ONLY public.brand_discoveries
    ADD CONSTRAINT uq_brand_discovery_idempotency UNIQUE (workspace_id, idempotency_key);

ALTER TABLE ONLY public.brand_discovery_tasks
    ADD CONSTRAINT uq_brand_discovery_task_discovery UNIQUE (discovery_id, task_kind);

ALTER TABLE ONLY public.brand_discovery_tasks
    ADD CONSTRAINT uq_brand_discovery_task_key UNIQUE (idempotency_key);

ALTER TABLE ONLY public.brand_logo_assets
    ADD CONSTRAINT uq_brand_logo_asset_domain UNIQUE (domain);

ALTER TABLE ONLY public.brand_profiles
    ADD CONSTRAINT uq_brand_profile_brand UNIQUE (brand_id);

ALTER TABLE ONLY public.brands
    ADD CONSTRAINT uq_brand_project UNIQUE (project_id);

ALTER TABLE ONLY public.brand_research_snapshots
    ADD CONSTRAINT uq_brand_research_version UNIQUE (discovery_id, research_version);

ALTER TABLE ONLY public.commerce_categories
    ADD CONSTRAINT uq_commerce_category_name UNIQUE (project_id, normalized_name);

ALTER TABLE ONLY public.commerce_competitor_attempts
    ADD CONSTRAINT uq_commerce_competitor_attempt UNIQUE (task_id, attempt_number);

ALTER TABLE ONLY public.commerce_competitor_candidates
    ADD CONSTRAINT uq_commerce_competitor_candidate UNIQUE (project_id, target_kind, target_id, canonical_url);

ALTER TABLE ONLY public.commerce_csv_imports
    ADD CONSTRAINT uq_commerce_csv_import_hash UNIQUE (project_id, content_hash);

ALTER TABLE ONLY public.commerce_observation_citations
    ADD CONSTRAINT uq_commerce_observation_citation UNIQUE (observation_id, citation_id);

ALTER TABLE ONLY public.commerce_product_categories
    ADD CONSTRAINT uq_commerce_product_category UNIQUE (product_id, category_id);

ALTER TABLE ONLY public.commerce_products
    ADD CONSTRAINT uq_commerce_product_url UNIQUE (project_id, canonical_url);

ALTER TABLE ONLY public.commerce_product_observations
    ADD CONSTRAINT uq_commerce_projection_analysis_version UNIQUE (source_analysis_id, projector_version);

ALTER TABLE ONLY public.commerce_prompt_targets
    ADD CONSTRAINT uq_commerce_prompt_target_prompt UNIQUE (prompt_id);

ALTER TABLE ONLY public.commerce_shelf_snapshots
    ADD CONSTRAINT uq_commerce_shelf_snapshot UNIQUE (audit_id, target_kind, target_id, formula_version);

ALTER TABLE ONLY public.consumable_ledger
    ADD CONSTRAINT uq_consumable_ledger_idempotency UNIQUE (billing_account_id, idempotency_key);

ALTER TABLE ONLY public.content_differentiation_candidates
    ADD CONSTRAINT uq_content_diff_candidate_task_page UNIQUE (audit_task_id, source_page_id);

ALTER TABLE ONLY public.content_differentiation_reports
    ADD CONSTRAINT uq_content_diff_report_task UNIQUE (audit_task_id);

ALTER TABLE ONLY public.crawl_log_batches
    ADD CONSTRAINT uq_crawl_log_batch_key UNIQUE (workspace_id, source_id, idempotency_key);

ALTER TABLE ONLY public.crawl_log_batches
    ADD CONSTRAINT uq_crawl_log_batches_scope UNIQUE (workspace_id, project_id, id);

ALTER TABLE ONLY public.crawl_log_coverage_daily
    ADD CONSTRAINT uq_crawl_log_coverage_daily_scope UNIQUE (workspace_id, project_id, id);

ALTER TABLE ONLY public.crawl_log_coverage_daily
    ADD CONSTRAINT uq_crawl_log_coverage_day UNIQUE (workspace_id, source_id, reporting_date, reporting_timezone);

ALTER TABLE ONLY public.crawl_log_sources
    ADD CONSTRAINT uq_crawl_log_sources_scope UNIQUE (workspace_id, project_id, id);

ALTER TABLE ONLY public.crawl_log_states
    ADD CONSTRAINT uq_crawl_log_state_project UNIQUE (workspace_id, project_id);

ALTER TABLE ONLY public.crawl_log_states
    ADD CONSTRAINT uq_crawl_log_states_scope UNIQUE (workspace_id, project_id, id);

ALTER TABLE ONLY public.crawl_log_uploads
    ADD CONSTRAINT uq_crawl_log_uploads_scope UNIQUE (workspace_id, project_id, id);

ALTER TABLE ONLY public.demand_signals
    ADD CONSTRAINT uq_demand_signal_identity UNIQUE (snapshot_id, identity_hash);

ALTER TABLE ONLY public.demand_snapshots
    ADD CONSTRAINT uq_demand_snapshot_source_hash UNIQUE (project_id, source_hash);

ALTER TABLE ONLY public.enterprise_agreement_references
    ADD CONSTRAINT uq_enterprise_agreement_reference UNIQUE (workspace_id, reference);

ALTER TABLE ONLY public.execution_cost_projections
    ADD CONSTRAINT uq_execution_cost_projection_version UNIQUE (raw_response_artifact_id, formula_version, pricing_version);

ALTER TABLE ONLY public.grant_revocations
    ADD CONSTRAINT uq_grant_revocation_idempotency UNIQUE (grant_id, idempotency_key);

ALTER TABLE ONLY public.idempotency_records
    ADD CONSTRAINT uq_idempotency_record_account_key UNIQUE (billing_account_id, idempotency_key);

ALTER TABLE ONLY public.integration_connections
    ADD CONSTRAINT uq_integration_connection_grant_provider UNIQUE (grant_id, provider);

ALTER TABLE ONLY public.integration_connections
    ADD CONSTRAINT uq_integration_connections_ws_id UNIQUE (workspace_id, id);

ALTER TABLE ONLY public.integration_oauth_grants
    ADD CONSTRAINT uq_integration_grant_ws_transport UNIQUE (workspace_id, transport);

ALTER TABLE ONLY public.integration_oauth_grants
    ADD CONSTRAINT uq_integration_grants_ws_id UNIQUE (workspace_id, id);

ALTER TABLE ONLY public.integration_import_artifacts
    ADD CONSTRAINT uq_integration_import_artifacts_ws_id UNIQUE (workspace_id, id);

ALTER TABLE ONLY public.integration_metric_rows
    ADD CONSTRAINT uq_integration_metric_row_identity UNIQUE (project_id, property_ref, provider, dataset, date, dimension_key, resync_seq);

ALTER TABLE ONLY public.integration_sync_runs
    ADD CONSTRAINT uq_integration_sync_run_connection_seq UNIQUE (connection_id, resync_seq);

ALTER TABLE ONLY public.integration_sync_runs
    ADD CONSTRAINT uq_integration_sync_run_idempotency_key UNIQUE (idempotency_key);

ALTER TABLE ONLY public.integration_sync_runs
    ADD CONSTRAINT uq_integration_sync_runs_ws_id UNIQUE (workspace_id, id);

ALTER TABLE ONLY public.metric_snapshots
    ADD CONSTRAINT uq_metric_snapshot_audit UNIQUE (audit_id);

ALTER TABLE ONLY public.monitored_site_urls
    ADD CONSTRAINT uq_monitored_site_url UNIQUE (project_id, site_url_id);

ALTER TABLE ONLY public.observed_entity_candidates
    ADD CONSTRAINT uq_observed_candidate_domain UNIQUE (audit_id, domain);

ALTER TABLE ONLY public.opportunity_implementation_events
    ADD CONSTRAINT uq_opportunity_implementation_action UNIQUE (action_id);

ALTER TABLE ONLY public.opportunity_implementation_events
    ADD CONSTRAINT uq_opportunity_implementation_ws_id UNIQUE (workspace_id, id);

ALTER TABLE ONLY public.opportunity_implementation_events
    ADD CONSTRAINT uq_opportunity_implementation_ws_idem UNIQUE (workspace_id, idempotency_key);

ALTER TABLE ONLY public.opportunity_orders
    ADD CONSTRAINT uq_opportunity_orders_project UNIQUE (project_id);

ALTER TABLE ONLY public.opportunity_snapshots
    ADD CONSTRAINT uq_opportunity_snapshot_run UNIQUE (run_id);

ALTER TABLE ONLY public.opportunity_verification_events
    ADD CONSTRAINT uq_opportunity_verification_ws_idem UNIQUE (workspace_id, idempotency_key);

ALTER TABLE ONLY public.overview_layouts
    ADD CONSTRAINT uq_overview_layouts_project UNIQUE (project_id);

ALTER TABLE ONLY public.pending_activations
    ADD CONSTRAINT uq_pending_activation_account_idempotency UNIQUE (billing_account_id, idempotency_key);

ALTER TABLE ONLY public.performance_dimension_stats
    ADD CONSTRAINT uq_performance_dimension_stat_key UNIQUE (snapshot_id, dimension, dimension_key);

ALTER TABLE ONLY public.policy_acceptances
    ADD CONSTRAINT uq_policy_acceptance_revision UNIQUE (actor_id, workspace_id, terms_revision);

ALTER TABLE ONLY public.account_policy_acceptances
    ADD CONSTRAINT uq_account_policy_acceptance_revision UNIQUE (actor_id, terms_revision);

ALTER TABLE ONLY public.projects
    ADD CONSTRAINT uq_projects_ws_id UNIQUE (workspace_id, id);

ALTER TABLE ONLY public.prompt_metric_snapshots
    ADD CONSTRAINT uq_prompt_metric_audit_identity UNIQUE (audit_id, prompt_identity);

ALTER TABLE ONLY public.prompts
    ADD CONSTRAINT uq_prompt_set_normalized_text UNIQUE (prompt_set_id, normalized_text_hash);

ALTER TABLE ONLY public.provider_capacity_buckets
    ADD CONSTRAINT uq_provider_capacity_bucket_pool UNIQUE NULLS NOT DISTINCT (pool_kind, transport_provider, account_pool_identity, connection_id, billing_account_id);

ALTER TABLE ONLY public.query_evidence_snapshots
    ADD CONSTRAINT uq_query_evidence_snapshot_identity UNIQUE (workspace_id, project_id, window_start, window_end, source_hash, analyzer_version);

ALTER TABLE ONLY public.query_evidence_rows
    ADD CONSTRAINT uq_query_evidence_source_row UNIQUE (snapshot_id, source_metric_row_id);

ALTER TABLE ONLY public.queue_workspace_turns
    ADD CONSTRAINT uq_queue_workspace_turn UNIQUE (queue_name, workspace_id);

ALTER TABLE ONLY public.referral_classifications
    ADD CONSTRAINT uq_referral_classification_event UNIQUE (referral_event_id);

ALTER TABLE ONLY public.referral_events
    ADD CONSTRAINT uq_referral_event_import_content UNIQUE (import_id, content_hash);

ALTER TABLE ONLY public.referral_events
    ADD CONSTRAINT uq_referral_events_ws_id UNIQUE (workspace_id, id);

ALTER TABLE ONLY public.response_analyses
    ADD CONSTRAINT uq_response_analysis_task UNIQUE (task_id);

ALTER TABLE ONLY public.robots_snapshots
    ADD CONSTRAINT uq_robots_snapshots_content UNIQUE (workspace_id, project_id, origin, content_hash);

ALTER TABLE ONLY public.robots_snapshots
    ADD CONSTRAINT uq_robots_snapshots_scope_id UNIQUE (workspace_id, project_id, id);

ALTER TABLE ONLY public.search_intelligence_calls
    ADD CONSTRAINT uq_si_call_request UNIQUE (run_id, request_key);

ALTER TABLE ONLY public.search_intelligence_calls
    ADD CONSTRAINT uq_si_call_scope_id UNIQUE (workspace_id, project_id, id);

ALTER TABLE ONLY public.search_intelligence_datasets
    ADD CONSTRAINT uq_si_datasets_scope_id UNIQUE (workspace_id, project_id, id);

ALTER TABLE ONLY public.search_intelligence_dispatch_attempts
    ADD CONSTRAINT uq_si_dispatch_phase UNIQUE (call_id, ordinal, phase);

ALTER TABLE ONLY public.search_intelligence_rows
    ADD CONSTRAINT uq_si_row_provider_key UNIQUE (dataset_id, provider_row_key);

ALTER TABLE ONLY public.search_intelligence_runs
    ADD CONSTRAINT uq_si_runs_idempotency UNIQUE (workspace_id, project_id, idempotency_key);

ALTER TABLE ONLY public.search_intelligence_runs
    ADD CONSTRAINT uq_si_runs_scope_id UNIQUE (workspace_id, project_id, id);

ALTER TABLE ONLY public.site_change_observations
    ADD CONSTRAINT uq_site_change_observation UNIQUE (snapshot_id, site_url_id, field);

ALTER TABLE ONLY public.site_change_snapshots
    ADD CONSTRAINT uq_site_change_snapshot_identity UNIQUE (workspace_id, crawl_a_id, crawl_b_id, source_hash, analyzer_version);

ALTER TABLE ONLY public.site_change_snapshots
    ADD CONSTRAINT uq_site_change_snapshot_ws_id UNIQUE (workspace_id, id);

ALTER TABLE ONLY public.site_crawl_tasks
    ADD CONSTRAINT uq_site_crawl_task_idempotency_key UNIQUE (idempotency_key);

ALTER TABLE ONLY public.site_crawl_tasks
    ADD CONSTRAINT uq_site_crawl_task_slot UNIQUE (crawl_id, task_kind, url_hash, generation);

ALTER TABLE ONLY public.site_crawls
    ADD CONSTRAINT uq_site_crawls_id_project UNIQUE (id, project_id, workspace_id);

ALTER TABLE ONLY public.site_discovery_frontier
    ADD CONSTRAINT uq_site_discovery_frontier_url UNIQUE (crawl_id, url_hash);

ALTER TABLE ONLY public.site_fetch_artifacts
    ADD CONSTRAINT uq_site_fetch_artifact_task UNIQUE (task_id);

ALTER TABLE ONLY public.site_fetch_attempts
    ADD CONSTRAINT uq_site_fetch_attempt_call UNIQUE (task_id, attempt_number, request_ordinal);

ALTER TABLE ONLY public.site_health_profiles
    ADD CONSTRAINT uq_site_health_profile_project UNIQUE (project_id);

ALTER TABLE ONLY public.site_health_snapshots
    ADD CONSTRAINT uq_site_health_snapshot_crawl UNIQUE (crawl_id);

ALTER TABLE ONLY public.site_issues
    ADD CONSTRAINT uq_site_issue_evaluation UNIQUE (evaluation_id);

ALTER TABLE ONLY public.site_observed_architectures
    ADD CONSTRAINT uq_site_observed_architecture UNIQUE (crawl_id, extractor_version, analyzer_version, rule_version, architecture_formula_version, archetype_policy_version);

ALTER TABLE ONLY public.site_page_link_metrics
    ADD CONSTRAINT uq_site_page_link_metric UNIQUE (crawl_id, site_url_id, extractor_version, formula_version);

ALTER TABLE ONLY public.site_rule_evaluations
    ADD CONSTRAINT uq_site_rule_evaluation UNIQUE NULLS NOT DISTINCT (analysis_id, rule_id, source_architecture_id);

ALTER TABLE ONLY public.site_url_observations
    ADD CONSTRAINT uq_site_url_observation UNIQUE (crawl_id, site_url_id);

ALTER TABLE ONLY public.site_urls
    ADD CONSTRAINT uq_site_url_project_hash UNIQUE (project_id, url_hash);

ALTER TABLE ONLY public.site_urls
    ADD CONSTRAINT uq_site_urls_id_project UNIQUE (id, project_id, workspace_id);

ALTER TABLE ONLY public.source_page_entity_presences
    ADD CONSTRAINT uq_source_page_presence_entity UNIQUE (snapshot_id, entity_kind, entity_name);

ALTER TABLE ONLY public.source_pages
    ADD CONSTRAINT uq_source_page_project_url UNIQUE (project_id, url_hash);

ALTER TABLE ONLY public.source_page_inspection_spend
    ADD CONSTRAINT uq_source_page_spend_key UNIQUE (idempotency_key);

ALTER TABLE ONLY public.source_pages
    ADD CONSTRAINT uq_source_pages_ws_project_id UNIQUE (workspace_id, project_id, id);

ALTER TABLE ONLY public.traffic_page_stats
    ADD CONSTRAINT uq_traffic_page_stat_url UNIQUE (snapshot_id, canonical_url);

ALTER TABLE ONLY public.traffic_query_stats
    ADD CONSTRAINT uq_traffic_query_stat_query UNIQUE (snapshot_id, normalized_query);

ALTER TABLE ONLY public.traffic_snapshots
    ADD CONSTRAINT uq_traffic_snapshot_window UNIQUE (project_id, window_start, window_end, granularity);

ALTER TABLE ONLY public.traffic_snapshots
    ADD CONSTRAINT uq_traffic_snapshots_ws_id UNIQUE (workspace_id, id);

ALTER TABLE ONLY public.traffic_snapshots
    ADD CONSTRAINT uq_traffic_snapshots_ws_project_id UNIQUE (workspace_id, project_id, id);

ALTER TABLE ONLY public.usage_windows
    ADD CONSTRAINT uq_usage_window_subject_operation_start UNIQUE (subject_kind, subject_hash, operation, window_started_at);

ALTER TABLE ONLY public.user_identities
    ADD CONSTRAINT uq_user_identities_provider_subject UNIQUE (provider, subject);

ALTER TABLE ONLY public.user_identities
    ADD CONSTRAINT uq_user_identities_user_provider UNIQUE (user_id, provider);

ALTER TABLE ONLY public.workspace_members
    ADD CONSTRAINT uq_workspace_member UNIQUE (workspace_id, user_id);

ALTER TABLE ONLY public.workspace_site_health_runtime
    ADD CONSTRAINT uq_ws_site_health_runtime_workspace UNIQUE (workspace_id);

ALTER TABLE ONLY public.usage_windows
    ADD CONSTRAINT usage_windows_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.user_identities
    ADD CONSTRAINT user_identities_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.web_acquisition_controls
    ADD CONSTRAINT web_acquisition_controls_pkey PRIMARY KEY (domain);

ALTER TABLE ONLY public.workspace_invitations
    ADD CONSTRAINT workspace_invitations_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.workspace_invitations
    ADD CONSTRAINT workspace_invitations_token_sha256_key UNIQUE (token_sha256);

ALTER TABLE ONLY public.workspace_members
    ADD CONSTRAINT workspace_members_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.workspace_site_health_runtime
    ADD CONSTRAINT workspace_site_health_runtime_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.workspaces
    ADD CONSTRAINT workspaces_pkey PRIMARY KEY (id);

CREATE INDEX ix_account_grant_account_key_valid ON public.account_grants USING btree (billing_account_id, key, valid_from);

CREATE INDEX ix_account_grant_source ON public.account_grants USING btree (source_kind, source_ref);

CREATE INDEX ix_account_grants_billing_account_id ON public.account_grants USING btree (billing_account_id);

CREATE INDEX ix_action_status_events_action_id ON public.action_status_events USING btree (action_id);

CREATE INDEX ix_action_status_events_project_created ON public.action_status_events USING btree (project_id, created_at, id);

CREATE INDEX ix_action_status_events_project_id ON public.action_status_events USING btree (project_id);

CREATE INDEX ix_action_status_events_workspace_id ON public.action_status_events USING btree (workspace_id);

CREATE INDEX ix_actions_list ON public.actions USING btree (project_id, priority_score, id);

CREATE INDEX ix_actions_project_id ON public.actions USING btree (project_id);

CREATE INDEX ix_actions_workspace_id ON public.actions USING btree (workspace_id);

CREATE INDEX ix_agent_chats_action_id ON public.agent_chats USING btree (action_id);

CREATE INDEX ix_agent_chats_project_activity ON public.agent_chats USING btree (project_id, last_activity_at, id);

CREATE INDEX ix_agent_chats_project_id ON public.agent_chats USING btree (project_id);

CREATE INDEX ix_agent_chats_workspace_id ON public.agent_chats USING btree (workspace_id);

CREATE INDEX ix_agent_instruction_revisions_project_id ON public.agent_instruction_revisions USING btree (project_id);

CREATE INDEX ix_agent_instruction_revisions_workspace_id ON public.agent_instruction_revisions USING btree (workspace_id);

CREATE INDEX ix_agent_messages_chat_id ON public.agent_messages USING btree (chat_id);

CREATE INDEX ix_agent_messages_project_id ON public.agent_messages USING btree (project_id);

CREATE INDEX ix_agent_messages_workspace_id ON public.agent_messages USING btree (workspace_id);

CREATE INDEX ix_agent_model_attempts_project_id ON public.agent_model_attempts USING btree (project_id);

CREATE INDEX ix_agent_model_attempts_run_id ON public.agent_model_attempts USING btree (run_id);

CREATE INDEX ix_agent_model_attempts_workspace_id ON public.agent_model_attempts USING btree (workspace_id);

CREATE INDEX ix_agent_output_revisions_output_id ON public.agent_output_revisions USING btree (output_id);

CREATE INDEX ix_agent_output_revisions_project_id ON public.agent_output_revisions USING btree (project_id);

CREATE INDEX ix_agent_output_revisions_workspace_id ON public.agent_output_revisions USING btree (workspace_id);

CREATE INDEX ix_agent_outputs_action_id ON public.agent_outputs USING btree (action_id);

CREATE INDEX ix_agent_outputs_project_id ON public.agent_outputs USING btree (project_id);

CREATE INDEX ix_agent_outputs_workspace_id ON public.agent_outputs USING btree (workspace_id);

CREATE INDEX ix_agent_runs_available_at ON public.agent_runs USING btree (available_at);

CREATE INDEX ix_agent_runs_chat_created ON public.agent_runs USING btree (chat_id, created_at, id);

CREATE INDEX ix_agent_runs_chat_id ON public.agent_runs USING btree (chat_id);

CREATE INDEX ix_agent_runs_project_id ON public.agent_runs USING btree (project_id);

CREATE INDEX ix_agent_runs_status ON public.agent_runs USING btree (status);

CREATE INDEX ix_agent_runs_workspace_id ON public.agent_runs USING btree (workspace_id);

CREATE INDEX ix_agent_tool_attempts_project_id ON public.agent_tool_attempts USING btree (project_id);

CREATE INDEX ix_agent_tool_attempts_run_id ON public.agent_tool_attempts USING btree (run_id);

CREATE INDEX ix_agent_run_transcripts_chat_id ON public.agent_run_transcripts USING btree (chat_id);

CREATE INDEX ix_agent_run_transcripts_workspace_id ON public.agent_run_transcripts USING btree (workspace_id);

CREATE INDEX ix_agent_tool_attempts_workspace_id ON public.agent_tool_attempts USING btree (workspace_id);

CREATE INDEX ix_ai_referrals_snapshots_project_id ON public.ai_referrals_snapshots USING btree (project_id);

CREATE INDEX ix_ai_referrals_snapshots_workspace_id ON public.ai_referrals_snapshots USING btree (workspace_id);

CREATE INDEX ix_aio_entity_links_domain ON public.aio_entity_links USING btree (observation_id, domain);

CREATE INDEX ix_aio_entity_links_observation_id ON public.aio_entity_links USING btree (observation_id);

CREATE INDEX ix_aio_entity_links_workspace_id ON public.aio_entity_links USING btree (workspace_id);

CREATE INDEX ix_aio_observations_audit_id ON public.aio_observations USING btree (audit_id);

CREATE INDEX ix_aio_observations_audit_outcome ON public.aio_observations USING btree (audit_id, outcome);

CREATE INDEX ix_aio_observations_outcome ON public.aio_observations USING btree (outcome);

CREATE INDEX ix_aio_observations_workspace_id ON public.aio_observations USING btree (workspace_id);

CREATE INDEX ix_analytics_tasks_available_at ON public.analytics_tasks USING btree (available_at);

CREATE INDEX ix_analytics_tasks_claim ON public.analytics_tasks USING btree (status, available_at);

CREATE INDEX ix_analytics_tasks_lease ON public.analytics_tasks USING btree (status, lease_expires_at);

CREATE INDEX ix_analytics_tasks_project_id ON public.analytics_tasks USING btree (project_id);

CREATE INDEX ix_analytics_tasks_status ON public.analytics_tasks USING btree (status);

CREATE INDEX ix_analytics_tasks_workspace_id ON public.analytics_tasks USING btree (workspace_id);

CREATE INDEX ix_answer_ad_observations_audit_id ON public.answer_ad_observations USING btree (audit_id);

CREATE INDEX ix_answer_ad_observations_task_id ON public.answer_ad_observations USING btree (task_id);

CREATE INDEX ix_answer_ad_observations_workspace_project ON public.answer_ad_observations USING btree (workspace_id, project_id);

CREATE INDEX ix_answer_perceptions_audit_id ON public.answer_perceptions USING btree (audit_id);

CREATE INDEX ix_answer_perceptions_workspace_id_created_at ON public.answer_perceptions USING btree (workspace_id, created_at);

CREATE INDEX ix_answer_claims_workspace_id ON public.answer_claims USING btree (workspace_id);

CREATE INDEX ix_brand_facts_workspace_id_project_id ON public.brand_facts USING btree (workspace_id, project_id);

CREATE INDEX ix_brand_fact_revisions_created_by_user_id ON public.brand_fact_revisions USING btree (created_by_user_id);

CREATE INDEX ix_brand_fact_revisions_workspace_id_fact_id ON public.brand_fact_revisions USING btree (workspace_id, fact_id);

CREATE INDEX ix_claim_verdicts_workspace_id_claim_id ON public.claim_verdicts USING btree (workspace_id, claim_id);

CREATE INDEX ix_claim_verdicts_workspace_id_verification_id ON public.claim_verdicts USING btree (workspace_id, verification_id);

CREATE INDEX ix_fact_verifications_audit_id ON public.fact_verifications USING btree (audit_id);

CREATE INDEX ix_fact_verifications_task_id ON public.fact_verifications USING btree (task_id);

CREATE INDEX ix_fact_verifications_workspace_id_created_at ON public.fact_verifications USING btree (workspace_id, created_at);

CREATE INDEX ix_api_idempotency_created_at ON public.api_idempotency USING btree (created_at);

CREATE INDEX ix_api_keys_created_by_user_id ON public.api_keys USING btree (created_by_user_id);

CREATE INDEX ix_entity_sentiments_workspace_id ON public.entity_sentiments USING btree (workspace_id);

CREATE INDEX ix_audit_engine_snapshots_audit_id ON public.audit_engine_snapshots USING btree (audit_id);

CREATE INDEX ix_audit_events_audit_id ON public.audit_events USING btree (audit_id);

CREATE INDEX ix_audit_events_audit_id_created_at_id ON public.audit_events USING btree (audit_id, created_at, id);

CREATE INDEX ix_audit_events_created_at ON public.audit_events USING btree (created_at);

CREATE INDEX ix_audit_prompt_snapshots_audit_id ON public.audit_prompt_snapshots USING btree (audit_id);

CREATE INDEX ix_audit_prompt_snapshots_cohort ON public.audit_prompt_snapshots USING btree (cohort);

CREATE INDEX ix_audit_schedules_due ON public.audit_schedules USING btree (enabled, next_run_at);

CREATE INDEX ix_audit_schedules_enabled ON public.audit_schedules USING btree (enabled);

CREATE INDEX ix_audit_schedules_lease ON public.audit_schedules USING btree (lease_expires_at);

CREATE INDEX ix_audit_schedules_next_run_at ON public.audit_schedules USING btree (next_run_at);

CREATE INDEX ix_audit_schedules_project_id ON public.audit_schedules USING btree (project_id);

CREATE INDEX ix_audit_schedules_prompt_set_id ON public.audit_schedules USING btree (prompt_set_id);

CREATE INDEX ix_audit_schedules_workspace_id ON public.audit_schedules USING btree (workspace_id);

CREATE INDEX ix_audit_tasks_audit_id ON public.audit_tasks USING btree (audit_id);

CREATE INDEX ix_audit_tasks_available_at ON public.audit_tasks USING btree (available_at);

CREATE INDEX ix_audit_tasks_project_id ON public.audit_tasks USING btree (project_id);

CREATE INDEX ix_audit_tasks_source_task_id ON public.audit_tasks USING btree (source_task_id);

CREATE INDEX ix_audit_tasks_status ON public.audit_tasks USING btree (status);

CREATE INDEX ix_audit_tasks_workspace_id ON public.audit_tasks USING btree (workspace_id);

CREATE INDEX ix_audits_funding_account_id ON public.audits USING btree (funding_account_id);

CREATE INDEX ix_audits_parent_audit_id ON public.audits USING btree (parent_audit_id);

CREATE INDEX ix_audits_project_id ON public.audits USING btree (project_id);

CREATE INDEX ix_audits_schedule_id ON public.audits USING btree (schedule_id);

CREATE INDEX ix_audits_launch_id ON public.audits USING btree (launch_id);

CREATE UNIQUE INDEX uq_audit_schedule_slot ON public.audits USING btree (schedule_id, scheduled_for, market_id) NULLS NOT DISTINCT WHERE (schedule_id IS NOT NULL);

CREATE INDEX ix_audits_status ON public.audits USING btree (status);

CREATE INDEX ix_audits_trigger ON public.audits USING btree (trigger);

CREATE INDEX ix_audits_workspace_id ON public.audits USING btree (workspace_id);

CREATE INDEX ix_billing_accounts_owner_user_id ON public.billing_accounts USING btree (owner_user_id);

CREATE UNIQUE INDEX ix_billing_accounts_workspace_id ON public.billing_accounts USING btree (workspace_id);

CREATE INDEX ix_billing_invoice_account_date ON public.billing_invoices USING btree (billing_account_id, invoice_date);

CREATE INDEX ix_billing_invoices_billing_account_id ON public.billing_invoices USING btree (billing_account_id);

CREATE INDEX ix_billing_payment_account_paid ON public.billing_payments USING btree (billing_account_id, paid_at);

CREATE INDEX ix_billing_payments_billing_account_id ON public.billing_payments USING btree (billing_account_id);

CREATE INDEX ix_billing_subscriptions_billing_account_id ON public.billing_subscriptions USING btree (billing_account_id);

CREATE INDEX ix_bot_requests_activity ON public.bot_requests USING btree (workspace_id, project_id, occurred_at, id);

CREATE INDEX ix_bot_requests_batch ON public.bot_requests USING btree (workspace_id, project_id, batch_id);

CREATE INDEX ix_bot_requests_retention ON public.bot_requests USING btree (workspace_id, occurred_at, id);

CREATE INDEX ix_bot_requests_source ON public.bot_requests USING btree (workspace_id, project_id, source_id);

CREATE INDEX ix_brand_aliases_brand_id ON public.brand_aliases USING btree (brand_id);

CREATE INDEX ix_brand_discoveries_status ON public.brand_discoveries USING btree (status);

CREATE INDEX ix_brand_discovery_tasks_available_at ON public.brand_discovery_tasks USING btree (available_at);

CREATE INDEX ix_brand_discovery_tasks_claim ON public.brand_discovery_tasks USING btree (status, available_at);

CREATE INDEX ix_brand_discovery_tasks_lease ON public.brand_discovery_tasks USING btree (status, lease_expires_at);

CREATE INDEX ix_brand_discovery_tasks_status ON public.brand_discovery_tasks USING btree (status);

CREATE INDEX ix_brand_mentions_analysis_id ON public.brand_mentions USING btree (analysis_id);

CREATE INDEX ix_brand_mentions_audit_id ON public.brand_mentions USING btree (audit_id);

CREATE INDEX ix_brand_mentions_workspace_id ON public.brand_mentions USING btree (workspace_id);

CREATE UNIQUE INDEX ix_brand_profiles_project_id ON public.brand_profiles USING btree (project_id);

CREATE INDEX ix_brand_profiles_workspace_id ON public.brand_profiles USING btree (workspace_id);

CREATE INDEX ix_brand_research_snapshots_discovery_id ON public.brand_research_snapshots USING btree (discovery_id);

CREATE INDEX ix_brand_research_snapshots_workspace_id ON public.brand_research_snapshots USING btree (workspace_id);

CREATE INDEX ix_branded_query_override_lookup ON public.branded_query_overrides USING btree (workspace_id, project_id, normalized_query, ordinal);

CREATE INDEX ix_branded_query_overrides_project_id ON public.branded_query_overrides USING btree (project_id);

CREATE INDEX ix_branded_query_overrides_workspace_id ON public.branded_query_overrides USING btree (workspace_id);

CREATE INDEX ix_brands_logo_asset_id ON public.brands USING btree (logo_asset_id);

CREATE INDEX ix_citations_analysis_id ON public.citations USING btree (analysis_id);

CREATE INDEX ix_citations_audit_id ON public.citations USING btree (audit_id);

CREATE INDEX ix_citations_workspace_id ON public.citations USING btree (workspace_id);

CREATE INDEX ix_citations_workspace_url_hash ON public.citations USING btree (workspace_id, url_hash);

CREATE INDEX ix_commerce_categories_project_id ON public.commerce_categories USING btree (project_id);

CREATE INDEX ix_commerce_categories_workspace_id ON public.commerce_categories USING btree (workspace_id);

CREATE INDEX ix_commerce_competitor_attempts_project_id ON public.commerce_competitor_attempts USING btree (project_id);

CREATE INDEX ix_commerce_competitor_attempts_target_id ON public.commerce_competitor_attempts USING btree (target_id);

CREATE INDEX ix_commerce_competitor_attempts_task_id ON public.commerce_competitor_attempts USING btree (task_id);

CREATE INDEX ix_commerce_competitor_attempts_workspace_id ON public.commerce_competitor_attempts USING btree (workspace_id);

CREATE INDEX ix_commerce_competitor_candidates_project_id ON public.commerce_competitor_candidates USING btree (project_id);

CREATE INDEX ix_commerce_competitor_candidates_target_id ON public.commerce_competitor_candidates USING btree (target_id);

CREATE INDEX ix_commerce_competitor_candidates_workspace_id ON public.commerce_competitor_candidates USING btree (workspace_id);

CREATE INDEX ix_commerce_csv_imports_project_id ON public.commerce_csv_imports USING btree (project_id);

CREATE INDEX ix_commerce_csv_imports_workspace_id ON public.commerce_csv_imports USING btree (workspace_id);

CREATE INDEX ix_commerce_observation_citations_citation_id ON public.commerce_observation_citations USING btree (citation_id);

CREATE INDEX ix_commerce_observation_citations_observation_id ON public.commerce_observation_citations USING btree (observation_id);

CREATE INDEX ix_commerce_observations_audit_target ON public.commerce_recommendation_observations USING btree (audit_id, target_kind, target_id);

CREATE INDEX ix_commerce_product_categories_category_id ON public.commerce_product_categories USING btree (category_id);

CREATE INDEX ix_commerce_product_categories_product_id ON public.commerce_product_categories USING btree (product_id);

CREATE INDEX ix_commerce_product_categories_project_id ON public.commerce_product_categories USING btree (project_id);

CREATE INDEX ix_commerce_product_categories_workspace_id ON public.commerce_product_categories USING btree (workspace_id);

CREATE INDEX ix_commerce_product_observations_product_id ON public.commerce_product_observations USING btree (product_id);

CREATE INDEX ix_commerce_product_observations_project_id ON public.commerce_product_observations USING btree (project_id);

CREATE INDEX ix_commerce_product_observations_workspace_id ON public.commerce_product_observations USING btree (workspace_id);

CREATE INDEX ix_commerce_products_project_id ON public.commerce_products USING btree (project_id);

CREATE INDEX ix_commerce_products_project_lifecycle ON public.commerce_products USING btree (project_id, lifecycle_state);

CREATE INDEX ix_commerce_products_workspace_id ON public.commerce_products USING btree (workspace_id);

CREATE INDEX ix_commerce_prompt_targets_project_id ON public.commerce_prompt_targets USING btree (project_id);

CREATE INDEX ix_commerce_prompt_targets_prompt_id ON public.commerce_prompt_targets USING btree (prompt_id);

CREATE INDEX ix_commerce_prompt_targets_target_id ON public.commerce_prompt_targets USING btree (target_id);

CREATE INDEX ix_commerce_prompt_targets_workspace_id ON public.commerce_prompt_targets USING btree (workspace_id);

CREATE INDEX ix_commerce_recommendation_observations_artifact_id ON public.commerce_recommendation_observations USING btree (artifact_id);

CREATE INDEX ix_commerce_recommendation_observations_audit_id ON public.commerce_recommendation_observations USING btree (audit_id);

CREATE INDEX ix_commerce_recommendation_observations_project_id ON public.commerce_recommendation_observations USING btree (project_id);

CREATE INDEX ix_commerce_recommendation_observations_target_id ON public.commerce_recommendation_observations USING btree (target_id);

CREATE INDEX ix_commerce_recommendation_observations_task_id ON public.commerce_recommendation_observations USING btree (task_id);

CREATE INDEX ix_commerce_recommendation_observations_workspace_id ON public.commerce_recommendation_observations USING btree (workspace_id);

CREATE INDEX ix_commerce_shelf_project_created ON public.commerce_shelf_snapshots USING btree (project_id, created_at);

CREATE INDEX ix_commerce_shelf_snapshots_audit_id ON public.commerce_shelf_snapshots USING btree (audit_id);

CREATE INDEX ix_commerce_shelf_snapshots_project_id ON public.commerce_shelf_snapshots USING btree (project_id);

CREATE INDEX ix_commerce_shelf_snapshots_target_id ON public.commerce_shelf_snapshots USING btree (target_id);

CREATE INDEX ix_commerce_shelf_snapshots_workspace_id ON public.commerce_shelf_snapshots USING btree (workspace_id);

CREATE INDEX ix_competitor_mentions_analysis_id ON public.competitor_mentions USING btree (analysis_id);

CREATE INDEX ix_competitor_mentions_audit_id ON public.competitor_mentions USING btree (audit_id);

CREATE INDEX ix_competitor_mentions_workspace_id ON public.competitor_mentions USING btree (workspace_id);

CREATE INDEX ix_competitors_logo_asset_id ON public.competitors USING btree (logo_asset_id);

CREATE INDEX ix_competitors_project_id ON public.competitors USING btree (project_id);

CREATE INDEX ix_consumable_ledger_billing_account_id ON public.consumable_ledger USING btree (billing_account_id);

CREATE INDEX ix_consumable_ledger_grant_key_created ON public.consumable_ledger USING btree (grant_id, capability_key, created_at);

CREATE INDEX ix_consumable_ledger_reservation_kind ON public.consumable_ledger USING btree (reservation_id, entry_kind);

CREATE INDEX ix_consumable_ledger_subject ON public.consumable_ledger USING btree (subject_kind, subject_id);

CREATE INDEX ix_platform_calls_workspace_created ON public.platform_calls USING btree (workspace_id, created_at);

CREATE INDEX ix_platform_calls_unsettled ON public.platform_calls USING btree (created_at) WHERE (((status)::text = 'reserved'::text) AND (NOT owner_settled));

CREATE INDEX ix_content_differentiation_candidates_audit_id ON public.content_differentiation_candidates USING btree (audit_id);

CREATE INDEX ix_content_differentiation_candidates_audit_task_id ON public.content_differentiation_candidates USING btree (audit_task_id);

CREATE INDEX ix_content_differentiation_candidates_project_id ON public.content_differentiation_candidates USING btree (project_id);

CREATE INDEX ix_content_differentiation_candidates_source_page_id ON public.content_differentiation_candidates USING btree (source_page_id);

CREATE INDEX ix_content_differentiation_candidates_workspace_id ON public.content_differentiation_candidates USING btree (workspace_id);

CREATE INDEX ix_content_differentiation_reports_audit_id ON public.content_differentiation_reports USING btree (audit_id);

CREATE INDEX ix_content_differentiation_reports_audit_task_id ON public.content_differentiation_reports USING btree (audit_task_id);

CREATE INDEX ix_content_differentiation_reports_project_id ON public.content_differentiation_reports USING btree (project_id);

CREATE INDEX ix_content_differentiation_reports_workspace_id ON public.content_differentiation_reports USING btree (workspace_id);

CREATE INDEX ix_crawl_log_batches_received ON public.crawl_log_batches USING btree (workspace_id, project_id, received_at) INCLUDE (bytes_received);

CREATE INDEX ix_crawl_log_batches_upload ON public.crawl_log_batches USING btree (workspace_id, project_id, upload_id);

CREATE INDEX ix_crawl_log_uploads_source ON public.crawl_log_uploads USING btree (workspace_id, project_id, source_id);

CREATE INDEX ix_demand_signals_project_id ON public.demand_signals USING btree (project_id);

CREATE INDEX ix_demand_signals_signal_type ON public.demand_signals USING btree (signal_type);

CREATE INDEX ix_demand_signals_snapshot_id ON public.demand_signals USING btree (snapshot_id);

CREATE INDEX ix_demand_signals_state ON public.demand_signals USING btree (state);

CREATE INDEX ix_demand_signals_workspace_id ON public.demand_signals USING btree (workspace_id);

CREATE INDEX ix_demand_snapshots_created_at ON public.demand_snapshots USING btree (created_at);

CREATE INDEX ix_demand_snapshots_project_id ON public.demand_snapshots USING btree (project_id);

CREATE INDEX ix_demand_snapshots_workspace_id ON public.demand_snapshots USING btree (workspace_id);

CREATE INDEX ix_enterprise_agreement_references_workspace_id ON public.enterprise_agreement_references USING btree (workspace_id);

CREATE INDEX ix_execution_cost_projections_audit_id ON public.execution_cost_projections USING btree (audit_id);

CREATE INDEX ix_execution_cost_projections_raw_response_artifact_id ON public.execution_cost_projections USING btree (raw_response_artifact_id);

CREATE INDEX ix_execution_cost_projections_task_id ON public.execution_cost_projections USING btree (task_id);

CREATE INDEX ix_grant_revocation_grant_effective ON public.grant_revocations USING btree (grant_id, effective_from);

CREATE INDEX ix_grant_revocations_grant_id ON public.grant_revocations USING btree (grant_id);

CREATE INDEX ix_idempotency_record_expiry ON public.idempotency_records USING btree (expires_at);

CREATE INDEX ix_idempotency_records_billing_account_id ON public.idempotency_records USING btree (billing_account_id);

CREATE INDEX ix_integration_connections_grant_id ON public.integration_connections USING btree (grant_id);

CREATE INDEX ix_integration_connections_workspace_id ON public.integration_connections USING btree (workspace_id);

CREATE INDEX ix_integration_events_connection_id ON public.integration_events USING btree (connection_id);

CREATE INDEX ix_integration_events_created_at ON public.integration_events USING btree (created_at);

CREATE INDEX ix_integration_events_workspace_id ON public.integration_events USING btree (workspace_id);

CREATE INDEX ix_integration_import_artifacts_connection_id ON public.integration_import_artifacts USING btree (connection_id);

CREATE INDEX ix_integration_import_artifacts_payload_hash ON public.integration_import_artifacts USING btree (payload_hash);

CREATE INDEX ix_integration_import_artifacts_sync_run_id ON public.integration_import_artifacts USING btree (sync_run_id);

CREATE INDEX ix_integration_import_artifacts_workspace_id ON public.integration_import_artifacts USING btree (workspace_id);

CREATE INDEX ix_integration_metric_rows_project_date ON public.integration_metric_rows USING btree (project_id, date);

CREATE INDEX ix_integration_metric_rows_project_id ON public.integration_metric_rows USING btree (project_id);

CREATE INDEX ix_integration_metric_rows_source_artifact_id ON public.integration_metric_rows USING btree (source_artifact_id);

CREATE INDEX ix_integration_metric_rows_workspace_id ON public.integration_metric_rows USING btree (workspace_id);

CREATE INDEX ix_integration_oauth_grants_status ON public.integration_oauth_grants USING btree (status);

CREATE INDEX ix_integration_oauth_grants_workspace_id ON public.integration_oauth_grants USING btree (workspace_id);

CREATE INDEX ix_integration_oauth_states_user_id ON public.integration_oauth_states USING btree (user_id);

CREATE INDEX ix_integration_oauth_states_workspace_id ON public.integration_oauth_states USING btree (workspace_id);

CREATE UNIQUE INDEX ix_integration_property_mappings_active_owner ON public.integration_property_mappings USING btree (workspace_id, provider, property_ref) WHERE ((status)::text = 'active'::text);

CREATE INDEX ix_integration_property_mappings_connection_id ON public.integration_property_mappings USING btree (connection_id);

CREATE INDEX ix_integration_property_mappings_project_id ON public.integration_property_mappings USING btree (project_id);

CREATE INDEX ix_integration_property_mappings_workspace_id ON public.integration_property_mappings USING btree (workspace_id);

CREATE UNIQUE INDEX ix_integration_sync_runs_active_window ON public.integration_sync_runs USING btree (mapping_id, sync_kind, window_start, window_end) WHERE ((status)::text = ANY ((ARRAY['leased'::character varying, 'queued'::character varying, 'retry_wait'::character varying, 'running'::character varying])::text[]));

CREATE INDEX ix_integration_sync_runs_available_at ON public.integration_sync_runs USING btree (available_at);

CREATE INDEX ix_integration_sync_runs_claim ON public.integration_sync_runs USING btree (status, available_at);

CREATE INDEX ix_integration_sync_runs_connection_id ON public.integration_sync_runs USING btree (connection_id);

CREATE INDEX ix_integration_sync_runs_lease ON public.integration_sync_runs USING btree (status, lease_expires_at);

CREATE INDEX ix_integration_sync_runs_mapping_id ON public.integration_sync_runs USING btree (mapping_id);

CREATE INDEX ix_integration_sync_runs_project_id ON public.integration_sync_runs USING btree (project_id);

CREATE INDEX ix_integration_sync_runs_status ON public.integration_sync_runs USING btree (status);

CREATE INDEX ix_integration_sync_runs_workspace_id ON public.integration_sync_runs USING btree (workspace_id);

CREATE UNIQUE INDEX ix_introductory_claims_billing_account_id ON public.introductory_claims USING btree (billing_account_id);

CREATE INDEX ix_mcp_authorization_codes_client_id ON public.mcp_authorization_codes USING btree (client_id);

CREATE UNIQUE INDEX ix_mcp_authorization_codes_code_hash ON public.mcp_authorization_codes USING btree (code_hash);

CREATE INDEX ix_mcp_authorization_codes_expires_at ON public.mcp_authorization_codes USING btree (expires_at);

CREATE INDEX ix_mcp_authorization_codes_user_id ON public.mcp_authorization_codes USING btree (user_id);

CREATE INDEX ix_mcp_authorization_requests_client_id ON public.mcp_authorization_requests USING btree (client_id);

CREATE INDEX ix_mcp_authorization_requests_expires_at ON public.mcp_authorization_requests USING btree (expires_at);

CREATE UNIQUE INDEX ix_mcp_authorization_requests_transaction_hash ON public.mcp_authorization_requests USING btree (transaction_hash);

CREATE INDEX ix_mcp_confirmations_expires_at ON public.mcp_confirmations USING btree (expires_at);

CREATE INDEX ix_mcp_confirmations_grant_id ON public.mcp_confirmations USING btree (grant_id);

CREATE UNIQUE INDEX ix_mcp_confirmations_token_hmac ON public.mcp_confirmations USING btree (token_hmac);

CREATE INDEX ix_mcp_confirmations_workspace_id ON public.mcp_confirmations USING btree (workspace_id);

CREATE UNIQUE INDEX ix_mcp_oauth_clients_client_id ON public.mcp_oauth_clients USING btree (client_id);

CREATE INDEX ix_mcp_oauth_grants_access_expires_at ON public.mcp_oauth_grants USING btree (access_expires_at);

CREATE UNIQUE INDEX ix_mcp_oauth_grants_access_token_hash ON public.mcp_oauth_grants USING btree (access_token_hash);

CREATE INDEX ix_mcp_oauth_grants_authorization_code_id ON public.mcp_oauth_grants USING btree (authorization_code_id);

CREATE INDEX ix_mcp_oauth_grants_client_id ON public.mcp_oauth_grants USING btree (client_id);

CREATE INDEX ix_mcp_oauth_grants_previous_refresh_token_hash ON public.mcp_oauth_grants USING btree (previous_refresh_token_hash);

CREATE INDEX ix_mcp_oauth_grants_refresh_expires_at ON public.mcp_oauth_grants USING btree (refresh_expires_at);

CREATE UNIQUE INDEX ix_mcp_oauth_grants_refresh_token_hash ON public.mcp_oauth_grants USING btree (refresh_token_hash);

CREATE INDEX ix_mcp_oauth_grants_user_id ON public.mcp_oauth_grants USING btree (user_id);

CREATE INDEX ix_metric_snapshots_project_id ON public.metric_snapshots USING btree (project_id);

CREATE INDEX ix_metric_snapshots_workspace_id ON public.metric_snapshots USING btree (workspace_id);

CREATE INDEX ix_monitored_site_urls_profile_id ON public.monitored_site_urls USING btree (profile_id);

CREATE INDEX ix_monitored_site_urls_project_id ON public.monitored_site_urls USING btree (project_id);

CREATE INDEX ix_monitored_site_urls_site_url_id ON public.monitored_site_urls USING btree (site_url_id);

CREATE INDEX ix_monitored_site_urls_workspace_id ON public.monitored_site_urls USING btree (workspace_id);

CREATE INDEX ix_monitored_site_urls_ws_active ON public.monitored_site_urls USING btree (workspace_id, active);

CREATE INDEX ix_observed_entity_candidates_audit_id ON public.observed_entity_candidates USING btree (audit_id);

CREATE INDEX ix_observed_entity_candidates_project_id ON public.observed_entity_candidates USING btree (project_id);

CREATE INDEX ix_observed_entity_candidates_status ON public.observed_entity_candidates USING btree (status);

CREATE INDEX ix_observed_entity_candidates_workspace_id ON public.observed_entity_candidates USING btree (workspace_id);

CREATE INDEX ix_opportunities_action_id ON public.opportunities USING btree (action_id);

CREATE INDEX ix_opportunities_filter ON public.opportunities USING btree (project_id, severity, opportunity_type);

CREATE INDEX ix_opportunities_list ON public.opportunities USING btree (project_id, priority_score, id);

CREATE INDEX ix_opportunities_project_id ON public.opportunities USING btree (project_id);

CREATE INDEX ix_opportunities_workspace_id ON public.opportunities USING btree (workspace_id);

CREATE INDEX ix_opportunity_implementation_events_opportunity_snapshot_id ON public.opportunity_implementation_events USING btree (opportunity_snapshot_id);

CREATE INDEX ix_opportunity_implementation_events_output_revision_id ON public.opportunity_implementation_events USING btree (output_revision_id);

CREATE INDEX ix_opportunity_implementation_events_project_id ON public.opportunity_implementation_events USING btree (project_id);

CREATE INDEX ix_opportunity_implementation_events_workspace_id ON public.opportunity_implementation_events USING btree (workspace_id);

CREATE INDEX ix_opportunity_implementation_project_created ON public.opportunity_implementation_events USING btree (project_id, created_at, id);

CREATE INDEX ix_opportunity_orders_workspace_id ON public.opportunity_orders USING btree (workspace_id);

CREATE INDEX ix_opportunity_snapshots_project_created ON public.opportunity_snapshots USING btree (project_id, created_at, id);

CREATE INDEX ix_opportunity_snapshots_project_id ON public.opportunity_snapshots USING btree (project_id);

CREATE INDEX ix_opportunity_snapshots_workspace_id ON public.opportunity_snapshots USING btree (workspace_id);

CREATE INDEX ix_opportunity_verification_events_implementation_event_id ON public.opportunity_verification_events USING btree (implementation_event_id);

CREATE INDEX ix_opportunity_verification_events_project_id ON public.opportunity_verification_events USING btree (project_id);

CREATE INDEX ix_opportunity_verification_events_workspace_id ON public.opportunity_verification_events USING btree (workspace_id);

CREATE INDEX ix_opportunity_verification_implementation_created ON public.opportunity_verification_events USING btree (implementation_event_id, created_at, id);

CREATE INDEX ix_overview_layouts_workspace_id ON public.overview_layouts USING btree (workspace_id);

CREATE INDEX ix_owned_domains_project_id ON public.owned_domains USING btree (project_id);

CREATE INDEX ix_pending_activation_status_created ON public.pending_activations USING btree (status, created_at);

CREATE INDEX ix_pending_activations_billing_account_id ON public.pending_activations USING btree (billing_account_id);

CREATE INDEX ix_performance_dimension_stats_dimension ON public.performance_dimension_stats USING btree (dimension);

CREATE INDEX ix_performance_dimension_stats_project_id ON public.performance_dimension_stats USING btree (project_id);

CREATE INDEX ix_performance_dimension_stats_snapshot_id ON public.performance_dimension_stats USING btree (snapshot_id);

CREATE INDEX ix_performance_dimension_stats_workspace_id ON public.performance_dimension_stats USING btree (workspace_id);

CREATE INDEX ix_policy_acceptances_workspace_id ON public.policy_acceptances USING btree (workspace_id);

CREATE INDEX ix_projects_workspace_id ON public.projects USING btree (workspace_id);

CREATE INDEX ix_prompt_candidates_run_id ON public.prompt_candidates USING btree (run_id);

CREATE INDEX ix_prompt_candidates_topic_id ON public.prompt_candidates USING btree (topic_id);

CREATE INDEX ix_prompt_candidates_workspace_id ON public.prompt_candidates USING btree (workspace_id);

CREATE INDEX ix_prompt_generation_runs_project_id ON public.prompt_generation_runs USING btree (project_id);

CREATE INDEX ix_prompt_generation_runs_prompt_set_id ON public.prompt_generation_runs USING btree (prompt_set_id);

CREATE INDEX ix_prompt_generation_runs_workspace_id ON public.prompt_generation_runs USING btree (workspace_id);

CREATE INDEX ix_prompt_metric_history ON public.prompt_metric_snapshots USING btree (project_id, prompt_identity, created_at DESC);

CREATE INDEX ix_prompt_metric_snapshots_audit_id ON public.prompt_metric_snapshots USING btree (audit_id);

CREATE INDEX ix_prompt_metric_snapshots_cohort ON public.prompt_metric_snapshots USING btree (cohort);

CREATE INDEX ix_prompt_metric_snapshots_created_at ON public.prompt_metric_snapshots USING btree (created_at);

CREATE INDEX ix_prompt_metric_snapshots_decline_confirmed ON public.prompt_metric_snapshots USING btree (decline_confirmed);

CREATE INDEX ix_prompt_metric_snapshots_project_id ON public.prompt_metric_snapshots USING btree (project_id);

CREATE INDEX ix_prompt_metric_snapshots_prompt_id ON public.prompt_metric_snapshots USING btree (prompt_id);

CREATE INDEX ix_prompt_metric_snapshots_workspace_id ON public.prompt_metric_snapshots USING btree (workspace_id);

CREATE INDEX ix_prompt_sets_project_id ON public.prompt_sets USING btree (project_id);

CREATE INDEX ix_prompts_cohort ON public.prompts USING btree (cohort);

CREATE INDEX ix_prompts_prompt_set_id ON public.prompts USING btree (prompt_set_id);

CREATE INDEX ix_prompts_topic_id ON public.prompts USING btree (topic_id);

CREATE INDEX ix_provider_attempts_audit_id ON public.provider_attempts USING btree (audit_id);

CREATE INDEX ix_provider_attempts_task_id ON public.provider_attempts USING btree (task_id);

CREATE INDEX ix_provider_capacity_buckets_blocked_until ON public.provider_capacity_buckets USING btree (blocked_until);

CREATE INDEX ix_provider_capacity_leases_analytics_task_id ON public.provider_capacity_leases USING btree (analytics_task_id);

CREATE INDEX ix_provider_capacity_leases_bucket_id ON public.provider_capacity_leases USING btree (bucket_id);

CREATE INDEX ix_provider_capacity_leases_expires_at ON public.provider_capacity_leases USING btree (expires_at);

CREATE INDEX ix_provider_capacity_leases_task_id ON public.provider_capacity_leases USING btree (task_id);

CREATE INDEX ix_provider_connection_tests_connection_id ON public.provider_connection_tests USING btree (connection_id);

CREATE INDEX ix_provider_connection_tests_workspace_id ON public.provider_connection_tests USING btree (workspace_id);

CREATE INDEX ix_provider_connections_workspace_id ON public.provider_connections USING btree (workspace_id);

CREATE INDEX ix_provider_connections_workspace_source ON public.provider_connections USING btree (workspace_id, credential_source, transport_provider);

CREATE INDEX ix_provider_routes_connection_id ON public.provider_routes USING btree (connection_id);

CREATE INDEX ix_provider_routes_workspace_id ON public.provider_routes USING btree (workspace_id);

CREATE INDEX ix_query_evidence_page_time ON public.query_evidence_rows USING btree (workspace_id, project_id, site_url_id, date);

CREATE INDEX ix_query_evidence_rows_date ON public.query_evidence_rows USING btree (date);

CREATE INDEX ix_query_evidence_rows_normalized_query ON public.query_evidence_rows USING btree (normalized_query);

CREATE INDEX ix_query_evidence_rows_project_id ON public.query_evidence_rows USING btree (project_id);

CREATE INDEX ix_query_evidence_rows_resolution_outcome ON public.query_evidence_rows USING btree (resolution_outcome);

CREATE INDEX ix_query_evidence_rows_snapshot_id ON public.query_evidence_rows USING btree (snapshot_id);

CREATE INDEX ix_query_evidence_rows_workspace_id ON public.query_evidence_rows USING btree (workspace_id);

CREATE INDEX ix_query_evidence_snapshots_created_at ON public.query_evidence_snapshots USING btree (created_at);

CREATE INDEX ix_query_evidence_snapshots_project_id ON public.query_evidence_snapshots USING btree (project_id);

CREATE INDEX ix_query_evidence_snapshots_workspace_id ON public.query_evidence_snapshots USING btree (workspace_id);

CREATE INDEX ix_queue_workspace_turn_order ON public.queue_workspace_turns USING btree (queue_name, last_claimed_at);

CREATE INDEX ix_raw_response_artifacts_audit_id ON public.raw_response_artifacts USING btree (audit_id);

CREATE INDEX ix_raw_response_artifacts_task_id ON public.raw_response_artifacts USING btree (task_id);

CREATE INDEX ix_referral_classifications_project_id ON public.referral_classifications USING btree (project_id);

CREATE INDEX ix_referral_classifications_workspace_id ON public.referral_classifications USING btree (workspace_id);

CREATE INDEX ix_referral_events_import_id ON public.referral_events USING btree (import_id);

CREATE INDEX ix_referral_events_project_id ON public.referral_events USING btree (project_id);

CREATE INDEX ix_referral_events_project_occurred ON public.referral_events USING btree (project_id, occurred_at);

CREATE INDEX ix_referral_events_workspace_id ON public.referral_events USING btree (workspace_id);

CREATE INDEX ix_response_analyses_audit_id ON public.response_analyses USING btree (audit_id);

CREATE INDEX ix_response_analyses_cohort ON public.response_analyses USING btree (cohort);

CREATE INDEX ix_response_analyses_workspace_id ON public.response_analyses USING btree (workspace_id);

CREATE INDEX ix_retrieved_sources_analysis_id ON public.retrieved_sources USING btree (analysis_id);

CREATE INDEX ix_retrieved_sources_audit_id ON public.retrieved_sources USING btree (audit_id);

CREATE INDEX ix_retrieved_sources_workspace_url_hash ON public.retrieved_sources USING btree (workspace_id, url_hash);

CREATE INDEX ix_search_intelligence_calls_dataset_id ON public.search_intelligence_calls USING btree (dataset_id);

CREATE INDEX ix_search_intelligence_calls_project_id ON public.search_intelligence_calls USING btree (project_id);

CREATE INDEX ix_search_intelligence_calls_run_id ON public.search_intelligence_calls USING btree (run_id);

CREATE INDEX ix_search_intelligence_calls_workspace_id ON public.search_intelligence_calls USING btree (workspace_id);

CREATE INDEX ix_search_intelligence_datasets_parent_dataset_id ON public.search_intelligence_datasets USING btree (parent_dataset_id);

CREATE INDEX ix_search_intelligence_datasets_project_id ON public.search_intelligence_datasets USING btree (project_id);

CREATE INDEX ix_search_intelligence_datasets_run_id ON public.search_intelligence_datasets USING btree (run_id);

CREATE INDEX ix_search_intelligence_datasets_scope_hash ON public.search_intelligence_datasets USING btree (scope_hash);

CREATE INDEX ix_search_intelligence_datasets_workspace_id ON public.search_intelligence_datasets USING btree (workspace_id);

CREATE INDEX ix_search_intelligence_dispatch_attempts_call_id ON public.search_intelligence_dispatch_attempts USING btree (call_id);

CREATE INDEX ix_search_intelligence_dispatch_attempts_project_id ON public.search_intelligence_dispatch_attempts USING btree (project_id);

CREATE INDEX ix_search_intelligence_dispatch_attempts_workspace_id ON public.search_intelligence_dispatch_attempts USING btree (workspace_id);

CREATE INDEX ix_search_intelligence_rows_call_id ON public.search_intelligence_rows USING btree (call_id);

CREATE INDEX ix_search_intelligence_rows_dataset_id ON public.search_intelligence_rows USING btree (dataset_id);

CREATE INDEX ix_search_intelligence_rows_project_id ON public.search_intelligence_rows USING btree (project_id);

CREATE INDEX ix_search_intelligence_rows_workspace_id ON public.search_intelligence_rows USING btree (workspace_id);

CREATE INDEX ix_search_intelligence_runs_connection_id ON public.search_intelligence_runs USING btree (connection_id);

CREATE INDEX ix_search_intelligence_runs_platform_call_id ON public.search_intelligence_runs USING btree (platform_call_id) WHERE (platform_call_id IS NOT NULL);

CREATE INDEX ix_search_intelligence_runs_project_id ON public.search_intelligence_runs USING btree (project_id);

CREATE INDEX ix_search_intelligence_runs_workspace_id ON public.search_intelligence_runs USING btree (workspace_id);

CREATE INDEX ix_security_events_occurred_at ON public.security_events USING btree (occurred_at);

CREATE INDEX ix_security_events_workspace_id ON public.security_events USING btree (workspace_id);

CREATE INDEX ix_si_datasets_latest ON public.search_intelligence_datasets USING btree (workspace_id, project_id, dataset_kind, published_at);

CREATE INDEX ix_si_rows_domain ON public.search_intelligence_rows USING btree (dataset_id, domain);

CREATE INDEX ix_si_rows_keyword ON public.search_intelligence_rows USING btree (dataset_id, keyword);

CREATE INDEX ix_si_rows_url ON public.search_intelligence_rows USING btree (dataset_id, url);

CREATE INDEX ix_si_runs_project_created ON public.search_intelligence_runs USING btree (workspace_id, project_id, created_at);

CREATE INDEX ix_site_change_observations_change_class ON public.site_change_observations USING btree (change_class);

CREATE INDEX ix_site_change_observations_site_url_id ON public.site_change_observations USING btree (site_url_id);

CREATE INDEX ix_site_change_observations_snapshot_id ON public.site_change_observations USING btree (snapshot_id);

CREATE INDEX ix_site_change_observations_workspace_id ON public.site_change_observations USING btree (workspace_id);

CREATE INDEX ix_site_change_snapshots_crawl_a_id ON public.site_change_snapshots USING btree (crawl_a_id);

CREATE INDEX ix_site_change_snapshots_crawl_b_id ON public.site_change_snapshots USING btree (crawl_b_id);

CREATE INDEX ix_site_change_snapshots_project_id ON public.site_change_snapshots USING btree (project_id);

CREATE INDEX ix_site_change_snapshots_workspace_id ON public.site_change_snapshots USING btree (workspace_id);

CREATE INDEX ix_site_crawl_events_crawl_id ON public.site_crawl_events USING btree (crawl_id);

CREATE INDEX ix_site_crawl_events_crawl_id_created_at_id ON public.site_crawl_events USING btree (crawl_id, created_at, id);

CREATE INDEX ix_site_crawl_events_created_at ON public.site_crawl_events USING btree (created_at);

CREATE INDEX ix_site_crawl_tasks_available_at ON public.site_crawl_tasks USING btree (available_at);

CREATE INDEX ix_site_crawl_tasks_claim ON public.site_crawl_tasks USING btree (status, available_at);

CREATE INDEX ix_site_crawl_tasks_crawl_id ON public.site_crawl_tasks USING btree (crawl_id);

CREATE INDEX ix_site_crawl_tasks_lease ON public.site_crawl_tasks USING btree (status, lease_expires_at);

CREATE INDEX ix_site_crawl_tasks_site_url_id ON public.site_crawl_tasks USING btree (site_url_id);

CREATE INDEX ix_site_crawl_tasks_status ON public.site_crawl_tasks USING btree (status);

CREATE INDEX ix_site_crawl_tasks_workspace_id ON public.site_crawl_tasks USING btree (workspace_id);

CREATE INDEX ix_site_crawls_profile_id ON public.site_crawls USING btree (profile_id);

CREATE INDEX ix_site_crawls_project_id ON public.site_crawls USING btree (project_id);

CREATE INDEX ix_site_crawls_robots_history ON public.site_crawls USING btree (workspace_id, project_id, robots_observed_at, id);

CREATE INDEX ix_site_crawls_status ON public.site_crawls USING btree (status);

CREATE INDEX ix_site_crawls_workspace_id ON public.site_crawls USING btree (workspace_id);

CREATE INDEX ix_site_discovery_frontier_crawl_id ON public.site_discovery_frontier USING btree (crawl_id);

CREATE INDEX ix_site_discovery_frontier_pending ON public.site_discovery_frontier USING btree (crawl_id, status, value_priority DESC, parent_position, link_ordinal, url_hash);

CREATE INDEX ix_site_discovery_frontier_workspace_id ON public.site_discovery_frontier USING btree (workspace_id);

CREATE INDEX ix_site_fetch_artifacts_crawl_id ON public.site_fetch_artifacts USING btree (crawl_id);

CREATE INDEX ix_site_fetch_artifacts_workspace_id ON public.site_fetch_artifacts USING btree (workspace_id);

CREATE INDEX ix_site_fetch_attempts_crawl_id ON public.site_fetch_attempts USING btree (crawl_id);

CREATE INDEX ix_site_fetch_attempts_task_id ON public.site_fetch_attempts USING btree (task_id);

CREATE INDEX ix_site_fetch_attempts_workspace_id ON public.site_fetch_attempts USING btree (workspace_id);

CREATE INDEX ix_site_health_profiles_workspace_id ON public.site_health_profiles USING btree (workspace_id);

CREATE INDEX ix_site_health_snapshots_project_id ON public.site_health_snapshots USING btree (project_id);

CREATE INDEX ix_site_health_snapshots_workspace_id ON public.site_health_snapshots USING btree (workspace_id);

CREATE INDEX ix_site_internal_link_events_project_id ON public.site_internal_link_events USING btree (project_id);

CREATE INDEX ix_site_internal_link_events_workspace_id ON public.site_internal_link_events USING btree (workspace_id);

CREATE INDEX ix_site_internal_link_runs_project_id ON public.site_internal_link_runs USING btree (project_id);

CREATE INDEX ix_site_internal_link_runs_workspace_id ON public.site_internal_link_runs USING btree (workspace_id);

CREATE INDEX ix_site_issues_analysis_id ON public.site_issues USING btree (analysis_id);

CREATE INDEX ix_site_issues_crawl_id ON public.site_issues USING btree (crawl_id);

CREATE INDEX ix_site_issues_filter ON public.site_issues USING btree (crawl_id, finding_class, severity, category, rule_id);

CREATE INDEX ix_site_issues_project_id ON public.site_issues USING btree (project_id);

CREATE INDEX ix_site_issues_site_url_id ON public.site_issues USING btree (site_url_id);

CREATE INDEX ix_site_issues_url_created ON public.site_issues USING btree (site_url_id, created_at);

CREATE INDEX ix_site_issues_workspace_id ON public.site_issues USING btree (workspace_id);

CREATE INDEX ix_site_observed_architectures_crawl_id ON public.site_observed_architectures USING btree (crawl_id);

CREATE INDEX ix_site_observed_architectures_project_id ON public.site_observed_architectures USING btree (project_id);

CREATE INDEX ix_site_observed_architectures_workspace_id ON public.site_observed_architectures USING btree (workspace_id);

CREATE INDEX ix_site_page_analyses_artifact_id ON public.site_page_analyses USING btree (artifact_id);

CREATE INDEX ix_site_page_analyses_crawl_id ON public.site_page_analyses USING btree (crawl_id);

CREATE INDEX ix_site_page_analyses_project_id ON public.site_page_analyses USING btree (project_id);

CREATE INDEX ix_site_page_analyses_site_url_id ON public.site_page_analyses USING btree (site_url_id);

CREATE INDEX ix_site_page_analyses_supersedes_analysis_id ON public.site_page_analyses USING btree (supersedes_analysis_id);

CREATE INDEX ix_site_page_analyses_workspace_id ON public.site_page_analyses USING btree (workspace_id);

CREATE INDEX ix_site_page_link_metrics_crawl_id ON public.site_page_link_metrics USING btree (crawl_id);

CREATE INDEX ix_site_page_link_metrics_project_id ON public.site_page_link_metrics USING btree (project_id);

CREATE INDEX ix_site_page_link_metrics_site_url_id ON public.site_page_link_metrics USING btree (site_url_id);

CREATE INDEX ix_site_page_link_metrics_workspace_id ON public.site_page_link_metrics USING btree (workspace_id);

CREATE INDEX ix_site_rule_evaluations_analysis_id ON public.site_rule_evaluations USING btree (analysis_id);

CREATE INDEX ix_site_rule_evaluations_source_architecture_id ON public.site_rule_evaluations USING btree (source_architecture_id);

CREATE INDEX ix_site_rule_evaluations_source_artifact_id ON public.site_rule_evaluations USING btree (source_artifact_id);

CREATE INDEX ix_site_rule_evaluations_workspace_id ON public.site_rule_evaluations USING btree (workspace_id);

CREATE INDEX ix_site_url_observations_crawl_id ON public.site_url_observations USING btree (crawl_id);

CREATE INDEX ix_site_url_observations_project_id ON public.site_url_observations USING btree (project_id);

CREATE INDEX ix_site_url_observations_site_url_id ON public.site_url_observations USING btree (site_url_id);

CREATE INDEX ix_site_url_observations_workspace_id ON public.site_url_observations USING btree (workspace_id);

CREATE INDEX ix_site_urls_project_id ON public.site_urls USING btree (project_id);

CREATE INDEX ix_site_urls_project_keyset ON public.site_urls USING btree (project_id, normalized_url, id);

CREATE INDEX ix_site_urls_workspace_id ON public.site_urls USING btree (workspace_id);

CREATE INDEX ix_source_page_entity_presences_project_id ON public.source_page_entity_presences USING btree (project_id);

CREATE INDEX ix_source_page_entity_presences_snapshot_id ON public.source_page_entity_presences USING btree (snapshot_id);

CREATE INDEX ix_source_page_entity_presences_source_page_id ON public.source_page_entity_presences USING btree (source_page_id);

CREATE INDEX ix_source_page_entity_presences_workspace_id ON public.source_page_entity_presences USING btree (workspace_id);

CREATE INDEX ix_source_page_inspection_spend_project_id ON public.source_page_inspection_spend USING btree (project_id);

CREATE INDEX ix_source_page_inspection_spend_workspace_id ON public.source_page_inspection_spend USING btree (workspace_id);

CREATE INDEX ix_source_page_presences_page_entity ON public.source_page_entity_presences USING btree (source_page_id, entity_kind, presence);

CREATE INDEX ix_source_page_snapshots_page_time ON public.source_page_snapshots USING btree (source_page_id, fetched_at);

CREATE INDEX ix_source_page_snapshots_project_id ON public.source_page_snapshots USING btree (project_id);

CREATE INDEX ix_source_page_snapshots_source_page_id ON public.source_page_snapshots USING btree (source_page_id);

CREATE INDEX ix_source_page_snapshots_workspace_id ON public.source_page_snapshots USING btree (workspace_id);

CREATE INDEX ix_source_page_spend_project_time ON public.source_page_inspection_spend USING btree (project_id, created_at);

CREATE INDEX ix_source_pages_project_domain ON public.source_pages USING btree (project_id, registrable_domain);

CREATE INDEX ix_source_pages_project_id ON public.source_pages USING btree (project_id);

CREATE INDEX ix_source_pages_project_state ON public.source_pages USING btree (project_id, inspection_state);

CREATE INDEX ix_source_pages_workspace_id ON public.source_pages USING btree (workspace_id);

CREATE INDEX ix_topics_parent_id ON public.topics USING btree (parent_id);

CREATE INDEX ix_topics_project_id ON public.topics USING btree (project_id);

CREATE INDEX ix_traffic_page_stats_project_id ON public.traffic_page_stats USING btree (project_id);

CREATE INDEX ix_traffic_page_stats_snapshot_id ON public.traffic_page_stats USING btree (snapshot_id);

CREATE INDEX ix_traffic_page_stats_workspace_id ON public.traffic_page_stats USING btree (workspace_id);

CREATE INDEX ix_traffic_query_stats_project_id ON public.traffic_query_stats USING btree (project_id);

CREATE INDEX ix_traffic_query_stats_snapshot_id ON public.traffic_query_stats USING btree (snapshot_id);

CREATE INDEX ix_traffic_query_stats_workspace_id ON public.traffic_query_stats USING btree (workspace_id);

CREATE INDEX ix_traffic_snapshots_project_id ON public.traffic_snapshots USING btree (project_id);

CREATE INDEX ix_traffic_snapshots_workspace_id ON public.traffic_snapshots USING btree (workspace_id);

CREATE INDEX ix_unintended_domains_project_id ON public.unintended_domains USING btree (project_id);

CREATE INDEX ix_usage_windows_expires_at ON public.usage_windows USING btree (expires_at);

CREATE INDEX ix_user_identities_user_id ON public.user_identities USING btree (user_id);

CREATE UNIQUE INDEX ix_users_email ON public.users USING btree (email);

CREATE INDEX ix_workspace_invitation_workspace ON public.workspace_invitations USING btree (workspace_id, created_at);

CREATE INDEX ix_workspace_members_user_id ON public.workspace_members USING btree (user_id);

CREATE UNIQUE INDEX uq_workspace_member_owner ON public.workspace_members USING btree (workspace_id) WHERE ((role)::text = 'owner'::text);

CREATE UNIQUE INDEX uq_workspace_member_owned_user ON public.workspace_members USING btree (user_id) WHERE ((role)::text = 'owner'::text);

CREATE UNIQUE INDEX uq_billing_catalog_revision_published ON public.billing_catalog_revisions USING btree (publication_state) WHERE ((publication_state)::text = 'published'::text);

CREATE UNIQUE INDEX uq_billing_payment_external ON public.billing_payments USING btree (provider, provider_mode, external_payment_id) WHERE ((receipt_kind)::text = 'payment'::text);

CREATE UNIQUE INDEX uq_billing_refund_external ON public.billing_payments USING btree (provider, provider_mode, external_refund_id) WHERE (external_refund_id IS NOT NULL);

CREATE UNIQUE INDEX uq_billing_subscription_one_current ON public.billing_subscriptions USING btree (billing_account_id) WHERE (is_current AND ((subscription_kind)::text = 'base'::text));

CREATE UNIQUE INDEX uq_bot_request_line ON public.bot_requests USING btree (workspace_id, source_id, line_hash) WHERE (provider_request_id IS NULL);

CREATE UNIQUE INDEX uq_bot_request_provider ON public.bot_requests USING btree (workspace_id, project_id, host, provider_request_id) WHERE (provider_request_id IS NOT NULL);

CREATE UNIQUE INDEX uq_consumable_ledger_subject_dispatch_allocation_debit ON public.consumable_ledger USING btree (subject_kind, subject_id, dispatch_key, grant_id) WHERE ((entry_kind)::text = 'debit'::text);

CREATE UNIQUE INDEX uq_consumable_ledger_task_attempt ON public.consumable_ledger USING btree (task_id, attempt, grant_id) WHERE ((entry_kind)::text = 'debit'::text);

CREATE UNIQUE INDEX uq_crawl_log_live_host ON public.crawl_log_sources USING btree (workspace_id, project_id, host) WHERE (((status)::text = 'active'::text) AND ((kind)::text = ANY ((ARRAY['webhook'::character varying, 'pull'::character varying])::text[])));

CREATE UNIQUE INDEX uq_opportunities_live_target ON public.opportunities USING btree (project_id, rule_id, target_key) WHERE (superseded_at IS NULL);

CREATE UNIQUE INDEX uq_pending_activation_one_pending_addon ON public.pending_activations USING btree (billing_account_id, catalog_key) WHERE (((activation_kind)::text = 'addon'::text) AND ((status)::text = 'pending'::text));

CREATE UNIQUE INDEX uq_pending_activation_one_pending_base ON public.pending_activations USING btree (billing_account_id) WHERE (((activation_kind)::text = 'base'::text) AND ((status)::text = 'pending'::text));

CREATE UNIQUE INDEX uq_pending_activation_one_pending_upgrade ON public.pending_activations USING btree (billing_account_id) WHERE (((activation_kind)::text = 'upgrade'::text) AND ((status)::text = 'pending'::text));

CREATE UNIQUE INDEX uq_pending_activation_provider_reference ON public.pending_activations USING btree (provider, provider_mode, external_reference) WHERE (external_reference IS NOT NULL);

CREATE UNIQUE INDEX uq_prompt_candidate_pending_text ON public.prompt_candidates USING btree (prompt_set_id, normalized_text_hash) WHERE ((disposition)::text = 'pending'::text);

CREATE UNIQUE INDEX uq_provider_capacity_lease_analytics_slot ON public.provider_capacity_leases USING btree (bucket_id, analytics_task_id, attempt_number, lease_kind) WHERE (analytics_task_id IS NOT NULL);

CREATE UNIQUE INDEX uq_provider_capacity_lease_audit_slot ON public.provider_capacity_leases USING btree (bucket_id, task_id, attempt_number, lease_kind) WHERE (task_id IS NOT NULL);

CREATE UNIQUE INDEX uq_si_runs_project_active ON public.search_intelligence_runs USING btree (workspace_id, project_id) WHERE ((status)::text = ANY ((ARRAY['queued'::character varying, 'running'::character varying])::text[]));

CREATE UNIQUE INDEX uq_site_page_analysis_current ON public.site_page_analyses USING btree (crawl_id, site_url_id) WHERE is_current;

CREATE UNIQUE INDEX uq_topic_project_name ON public.topics USING btree (project_id, lower((name)::text));

CREATE UNIQUE INDEX uq_workspace_invitation_pending_email ON public.workspace_invitations USING btree (workspace_id, email_normalized) WHERE ((accepted_at IS NULL) AND (revoked_at IS NULL));

CREATE UNIQUE INDEX uq_workspaces_single_system ON public.workspaces USING btree (is_system) WHERE is_system;

ALTER TABLE ONLY public.account_grants
    ADD CONSTRAINT account_grants_billing_account_id_fkey FOREIGN KEY (billing_account_id) REFERENCES public.billing_accounts(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.action_status_events
    ADD CONSTRAINT action_status_events_action_id_fkey FOREIGN KEY (action_id) REFERENCES public.actions(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.action_status_events
    ADD CONSTRAINT action_status_events_changed_by_user_id_fkey FOREIGN KEY (changed_by_user_id) REFERENCES public.users(id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.action_status_events
    ADD CONSTRAINT action_status_events_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.action_status_events
    ADD CONSTRAINT action_status_events_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.actions
    ADD CONSTRAINT actions_created_by_user_id_fkey FOREIGN KEY (created_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.actions
    ADD CONSTRAINT actions_opportunity_snapshot_id_fkey FOREIGN KEY (opportunity_snapshot_id) REFERENCES public.opportunity_snapshots(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.actions
    ADD CONSTRAINT actions_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.actions
    ADD CONSTRAINT actions_target_prompt_id_fkey FOREIGN KEY (target_prompt_id) REFERENCES public.prompts(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.actions
    ADD CONSTRAINT actions_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.agent_chats
    ADD CONSTRAINT agent_chats_action_id_fkey FOREIGN KEY (action_id) REFERENCES public.actions(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.agent_chats
    ADD CONSTRAINT agent_chats_created_by_user_id_fkey FOREIGN KEY (created_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.agent_chats
    ADD CONSTRAINT agent_chats_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.agent_chats
    ADD CONSTRAINT agent_chats_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.agent_instruction_revisions
    ADD CONSTRAINT agent_instruction_revisions_created_by_user_id_fkey FOREIGN KEY (created_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.agent_instruction_revisions
    ADD CONSTRAINT agent_instruction_revisions_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.agent_instruction_revisions
    ADD CONSTRAINT agent_instruction_revisions_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.agent_messages
    ADD CONSTRAINT agent_messages_author_user_id_fkey FOREIGN KEY (author_user_id) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.agent_messages
    ADD CONSTRAINT agent_messages_chat_id_fkey FOREIGN KEY (chat_id) REFERENCES public.agent_chats(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.agent_messages
    ADD CONSTRAINT agent_messages_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.agent_messages
    ADD CONSTRAINT agent_messages_reply_to_message_id_fkey FOREIGN KEY (reply_to_message_id) REFERENCES public.agent_messages(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.agent_messages
    ADD CONSTRAINT agent_messages_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.agent_model_attempts
    ADD CONSTRAINT agent_model_attempts_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.agent_output_revisions
    ADD CONSTRAINT agent_output_revisions_approved_by_user_id_fkey FOREIGN KEY (approved_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.agent_output_revisions
    ADD CONSTRAINT agent_output_revisions_author_user_id_fkey FOREIGN KEY (author_user_id) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.agent_output_revisions
    ADD CONSTRAINT agent_output_revisions_message_id_fkey FOREIGN KEY (message_id) REFERENCES public.agent_messages(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.agent_output_revisions
    ADD CONSTRAINT agent_output_revisions_output_id_fkey FOREIGN KEY (output_id) REFERENCES public.agent_outputs(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.agent_output_revisions
    ADD CONSTRAINT agent_output_revisions_parent_revision_id_fkey FOREIGN KEY (parent_revision_id) REFERENCES public.agent_output_revisions(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.agent_output_revisions
    ADD CONSTRAINT agent_output_revisions_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.agent_output_revisions
    ADD CONSTRAINT agent_output_revisions_run_id_fkey FOREIGN KEY (run_id) REFERENCES public.agent_runs(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.agent_output_revisions
    ADD CONSTRAINT agent_output_revisions_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.agent_outputs
    ADD CONSTRAINT agent_outputs_action_id_fkey FOREIGN KEY (action_id) REFERENCES public.actions(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.agent_outputs
    ADD CONSTRAINT agent_outputs_chat_id_fkey FOREIGN KEY (chat_id) REFERENCES public.agent_chats(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.agent_outputs
    ADD CONSTRAINT agent_outputs_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.agent_outputs
    ADD CONSTRAINT agent_outputs_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.agent_runs
    ADD CONSTRAINT agent_runs_chat_id_fkey FOREIGN KEY (chat_id) REFERENCES public.agent_chats(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.agent_runs
    ADD CONSTRAINT agent_runs_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.agent_runs
    ADD CONSTRAINT agent_runs_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.agent_runs
    ADD CONSTRAINT agent_runs_user_message_id_fkey FOREIGN KEY (user_message_id) REFERENCES public.agent_messages(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.agent_runs
    ADD CONSTRAINT agent_runs_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.agent_run_transcripts
    ADD CONSTRAINT agent_run_transcripts_chat_id_fkey FOREIGN KEY (chat_id) REFERENCES public.agent_chats(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.agent_run_transcripts
    ADD CONSTRAINT agent_run_transcripts_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.agent_run_transcripts
    ADD CONSTRAINT agent_run_transcripts_run_id_fkey FOREIGN KEY (run_id) REFERENCES public.agent_runs(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.agent_run_transcripts
    ADD CONSTRAINT agent_run_transcripts_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.agent_tool_attempts
    ADD CONSTRAINT agent_tool_attempts_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.agent_tool_attempts
    ADD CONSTRAINT agent_tool_attempts_run_id_fkey FOREIGN KEY (run_id) REFERENCES public.agent_runs(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.agent_tool_attempts
    ADD CONSTRAINT agent_tool_attempts_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.ai_referral_landing_daily
    ADD CONSTRAINT ai_referral_landing_daily_workspace_id_project_id_fkey FOREIGN KEY (workspace_id, project_id) REFERENCES public.projects(workspace_id, id) ON DELETE CASCADE;

ALTER TABLE ONLY public.ai_referrals_snapshots
    ADD CONSTRAINT ai_referrals_snapshots_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.ai_referrals_snapshots
    ADD CONSTRAINT ai_referrals_snapshots_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.ai_traffic_insights
    ADD CONSTRAINT ai_traffic_insights_workspace_id_project_id_fkey FOREIGN KEY (workspace_id, project_id) REFERENCES public.projects(workspace_id, id) ON DELETE CASCADE;

ALTER TABLE ONLY public.aio_entity_links
    ADD CONSTRAINT aio_entity_links_observation_id_fkey FOREIGN KEY (observation_id) REFERENCES public.aio_observations(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.aio_entity_links
    ADD CONSTRAINT aio_entity_links_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.aio_observations
    ADD CONSTRAINT aio_observations_audit_id_fkey FOREIGN KEY (audit_id) REFERENCES public.audits(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.aio_observations
    ADD CONSTRAINT aio_observations_provider_connection_id_fkey FOREIGN KEY (provider_connection_id) REFERENCES public.provider_connections(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.aio_observations
    ADD CONSTRAINT aio_observations_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.audit_tasks(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.aio_observations
    ADD CONSTRAINT aio_observations_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.analytics_tasks
    ADD CONSTRAINT analytics_tasks_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.analytics_tasks
    ADD CONSTRAINT analytics_tasks_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.answer_ad_observations
    ADD CONSTRAINT answer_ad_observations_artifact_id_fkey FOREIGN KEY (artifact_id) REFERENCES public.raw_response_artifacts(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.answer_ad_observations
    ADD CONSTRAINT answer_ad_observations_workspace_project_audit_task_fkey FOREIGN KEY (workspace_id, project_id, audit_id, task_id) REFERENCES public.audit_tasks(workspace_id, project_id, audit_id, id) ON DELETE CASCADE;

ALTER TABLE ONLY public.answer_ad_observations
    ADD CONSTRAINT answer_ad_observations_workspace_project_audit_fkey FOREIGN KEY (workspace_id, project_id, audit_id) REFERENCES public.audits(workspace_id, project_id, id) ON DELETE CASCADE;

ALTER TABLE ONLY public.answer_perceptions
    ADD CONSTRAINT answer_perceptions_analysis_id_fkey FOREIGN KEY (analysis_id) REFERENCES public.response_analyses(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.answer_perceptions
    ADD CONSTRAINT answer_perceptions_artifact_id_fkey FOREIGN KEY (artifact_id) REFERENCES public.raw_response_artifacts(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.answer_perceptions
    ADD CONSTRAINT answer_perceptions_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.audit_tasks(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.answer_perceptions
    ADD CONSTRAINT answer_perceptions_workspace_id_project_id_audit_id_fkey FOREIGN KEY (workspace_id, project_id, audit_id) REFERENCES public.audits(workspace_id, project_id, id) ON DELETE CASCADE;

ALTER TABLE ONLY public.answer_perceptions
    ADD CONSTRAINT answer_perceptions_workspace_id_project_id_fkey FOREIGN KEY (workspace_id, project_id) REFERENCES public.projects(workspace_id, id) ON DELETE CASCADE;

ALTER TABLE ONLY public.api_idempotency
    ADD CONSTRAINT api_idempotency_workspace_id_api_key_id_fkey FOREIGN KEY (workspace_id, api_key_id) REFERENCES public.api_keys(workspace_id, id) ON DELETE CASCADE;

ALTER TABLE ONLY public.api_keys
    ADD CONSTRAINT api_keys_created_by_user_id_fkey FOREIGN KEY (created_by_user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.api_keys
    ADD CONSTRAINT api_keys_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.entity_sentiments
    ADD CONSTRAINT entity_sentiments_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.entity_sentiments
    ADD CONSTRAINT entity_sentiments_workspace_id_perception_id_fkey FOREIGN KEY (workspace_id, perception_id) REFERENCES public.answer_perceptions(workspace_id, id) ON DELETE CASCADE;

ALTER TABLE ONLY public.answer_claims
    ADD CONSTRAINT answer_claims_workspace_id_perception_id_fkey FOREIGN KEY (workspace_id, perception_id) REFERENCES public.answer_perceptions(workspace_id, id) ON DELETE CASCADE;

ALTER TABLE ONLY public.brand_facts
    ADD CONSTRAINT brand_facts_workspace_id_project_id_fkey FOREIGN KEY (workspace_id, project_id) REFERENCES public.projects(workspace_id, id) ON DELETE CASCADE;

ALTER TABLE ONLY public.brand_fact_revisions
    ADD CONSTRAINT brand_fact_revisions_workspace_id_fact_id_fkey FOREIGN KEY (workspace_id, fact_id) REFERENCES public.brand_facts(workspace_id, id) ON DELETE CASCADE;

ALTER TABLE ONLY public.brand_fact_revisions
    ADD CONSTRAINT brand_fact_revisions_created_by_user_id_fkey FOREIGN KEY (created_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.fact_verifications
    ADD CONSTRAINT fact_verifications_workspace_id_perception_id_fkey FOREIGN KEY (workspace_id, perception_id) REFERENCES public.answer_perceptions(workspace_id, id) ON DELETE CASCADE;

ALTER TABLE ONLY public.fact_verifications
    ADD CONSTRAINT fact_verifications_workspace_id_project_id_audit_id_fkey FOREIGN KEY (workspace_id, project_id, audit_id) REFERENCES public.audits(workspace_id, project_id, id) ON DELETE CASCADE;

ALTER TABLE ONLY public.fact_verifications
    ADD CONSTRAINT fact_verifications_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.audit_tasks(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.claim_verdicts
    ADD CONSTRAINT claim_verdicts_workspace_id_verification_id_fkey FOREIGN KEY (workspace_id, verification_id) REFERENCES public.fact_verifications(workspace_id, id) ON DELETE CASCADE;

ALTER TABLE ONLY public.claim_verdicts
    ADD CONSTRAINT claim_verdicts_workspace_id_claim_id_fkey FOREIGN KEY (workspace_id, claim_id) REFERENCES public.answer_claims(workspace_id, id) ON DELETE CASCADE;

ALTER TABLE ONLY public.audit_engine_snapshots
    ADD CONSTRAINT audit_engine_snapshots_audit_id_fkey FOREIGN KEY (audit_id) REFERENCES public.audits(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.audit_engine_snapshots
    ADD CONSTRAINT audit_engine_snapshots_connection_id_fkey FOREIGN KEY (connection_id) REFERENCES public.provider_connections(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.audit_events
    ADD CONSTRAINT audit_events_audit_id_fkey FOREIGN KEY (audit_id) REFERENCES public.audits(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.audit_prompt_snapshots
    ADD CONSTRAINT audit_prompt_snapshots_audit_id_fkey FOREIGN KEY (audit_id) REFERENCES public.audits(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.audit_prompt_snapshots
    ADD CONSTRAINT audit_prompt_snapshots_prompt_id_fkey FOREIGN KEY (prompt_id) REFERENCES public.prompts(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.audit_schedules
    ADD CONSTRAINT audit_schedules_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.audit_schedules
    ADD CONSTRAINT audit_schedules_prompt_set_id_fkey FOREIGN KEY (prompt_set_id) REFERENCES public.prompt_sets(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.audit_schedules
    ADD CONSTRAINT audit_schedules_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.audit_tasks
    ADD CONSTRAINT audit_tasks_engine_snapshot_id_fkey FOREIGN KEY (engine_snapshot_id) REFERENCES public.audit_engine_snapshots(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.audit_tasks
    ADD CONSTRAINT audit_tasks_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.audit_tasks
    ADD CONSTRAINT audit_tasks_prompt_snapshot_id_fkey FOREIGN KEY (prompt_snapshot_id) REFERENCES public.audit_prompt_snapshots(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.audit_tasks
    ADD CONSTRAINT audit_tasks_provider_connection_id_fkey FOREIGN KEY (provider_connection_id) REFERENCES public.provider_connections(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.audit_tasks
    ADD CONSTRAINT audit_tasks_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.audit_tasks
    ADD CONSTRAINT audit_tasks_workspace_id_project_id_audit_id_fkey FOREIGN KEY (workspace_id, project_id, audit_id) REFERENCES public.audits(workspace_id, project_id, id) ON DELETE CASCADE;

ALTER TABLE ONLY public.audits
    ADD CONSTRAINT audits_funding_account_id_fkey FOREIGN KEY (funding_account_id) REFERENCES public.billing_accounts(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.audits
    ADD CONSTRAINT audits_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.audits
    ADD CONSTRAINT audits_workspace_id_project_id_fkey FOREIGN KEY (workspace_id, project_id) REFERENCES public.projects(workspace_id, id) ON DELETE CASCADE;

ALTER TABLE ONLY public.auth_challenges
    ADD CONSTRAINT auth_challenges_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.billing_accounts
    ADD CONSTRAINT billing_accounts_owner_user_id_fkey FOREIGN KEY (owner_user_id) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.billing_accounts
    ADD CONSTRAINT billing_accounts_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.billing_catalog_revisions
    ADD CONSTRAINT billing_catalog_revisions_created_by_user_id_fkey FOREIGN KEY (created_by_user_id) REFERENCES public.users(id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.billing_catalog_revisions
    ADD CONSTRAINT billing_catalog_revisions_published_by_user_id_fkey FOREIGN KEY (published_by_user_id) REFERENCES public.users(id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.billing_invoices
    ADD CONSTRAINT billing_invoices_billing_account_id_fkey FOREIGN KEY (billing_account_id) REFERENCES public.billing_accounts(id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.billing_invoices
    ADD CONSTRAINT billing_invoices_payment_id_fkey FOREIGN KEY (payment_id) REFERENCES public.billing_payments(id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.billing_payments
    ADD CONSTRAINT billing_payments_billing_account_id_fkey FOREIGN KEY (billing_account_id) REFERENCES public.billing_accounts(id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.billing_payments
    ADD CONSTRAINT billing_payments_parent_payment_id_fkey FOREIGN KEY (parent_payment_id) REFERENCES public.billing_payments(id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.billing_payments
    ADD CONSTRAINT billing_payments_pending_activation_id_fkey FOREIGN KEY (pending_activation_id) REFERENCES public.pending_activations(id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.billing_payments
    ADD CONSTRAINT billing_payments_subscription_id_fkey FOREIGN KEY (subscription_id) REFERENCES public.billing_subscriptions(id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.billing_subscriptions
    ADD CONSTRAINT billing_subscriptions_billing_account_id_fkey FOREIGN KEY (billing_account_id) REFERENCES public.billing_accounts(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.bot_activity_daily
    ADD CONSTRAINT bot_activity_daily_workspace_id_project_id_fkey FOREIGN KEY (workspace_id, project_id) REFERENCES public.projects(workspace_id, id) ON DELETE CASCADE;

ALTER TABLE ONLY public.bot_requests
    ADD CONSTRAINT bot_requests_ip_range_snapshot_id_fkey FOREIGN KEY (ip_range_snapshot_id) REFERENCES public.bot_ip_range_snapshots(id);

ALTER TABLE ONLY public.bot_requests
    ADD CONSTRAINT bot_requests_workspace_id_project_id_batch_id_fkey FOREIGN KEY (workspace_id, project_id, batch_id) REFERENCES public.crawl_log_batches(workspace_id, project_id, id) ON DELETE CASCADE;

ALTER TABLE ONLY public.bot_requests
    ADD CONSTRAINT bot_requests_workspace_id_project_id_fkey FOREIGN KEY (workspace_id, project_id) REFERENCES public.projects(workspace_id, id) ON DELETE CASCADE;

ALTER TABLE ONLY public.bot_requests
    ADD CONSTRAINT bot_requests_workspace_id_project_id_source_id_fkey FOREIGN KEY (workspace_id, project_id, source_id) REFERENCES public.crawl_log_sources(workspace_id, project_id, id) ON DELETE CASCADE;

ALTER TABLE ONLY public.brand_aliases
    ADD CONSTRAINT brand_aliases_brand_id_fkey FOREIGN KEY (brand_id) REFERENCES public.brands(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.brand_discoveries
    ADD CONSTRAINT brand_discoveries_initial_crawl_id_fkey FOREIGN KEY (initial_crawl_id) REFERENCES public.site_crawls(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.brand_discoveries
    ADD CONSTRAINT brand_discoveries_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.brand_discoveries
    ADD CONSTRAINT brand_discoveries_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.brand_discovery_tasks
    ADD CONSTRAINT brand_discovery_tasks_discovery_id_fkey FOREIGN KEY (discovery_id) REFERENCES public.brand_discoveries(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.brand_discovery_tasks
    ADD CONSTRAINT brand_discovery_tasks_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.brand_mentions
    ADD CONSTRAINT brand_mentions_analysis_id_fkey FOREIGN KEY (analysis_id) REFERENCES public.response_analyses(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.brand_mentions
    ADD CONSTRAINT brand_mentions_artifact_id_fkey FOREIGN KEY (artifact_id) REFERENCES public.raw_response_artifacts(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.brand_mentions
    ADD CONSTRAINT brand_mentions_audit_id_fkey FOREIGN KEY (audit_id) REFERENCES public.audits(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.brand_mentions
    ADD CONSTRAINT brand_mentions_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.brand_profiles
    ADD CONSTRAINT brand_profiles_brand_id_fkey FOREIGN KEY (brand_id) REFERENCES public.brands(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.brand_profiles
    ADD CONSTRAINT brand_profiles_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.brand_profiles
    ADD CONSTRAINT brand_profiles_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.brand_research_snapshots
    ADD CONSTRAINT brand_research_snapshots_discovery_id_fkey FOREIGN KEY (discovery_id) REFERENCES public.brand_discoveries(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.brand_research_snapshots
    ADD CONSTRAINT brand_research_snapshots_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.branded_query_overrides
    ADD CONSTRAINT branded_query_overrides_actor_user_id_fkey FOREIGN KEY (actor_user_id) REFERENCES public.users(id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.branded_query_overrides
    ADD CONSTRAINT branded_query_overrides_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.branded_query_overrides
    ADD CONSTRAINT branded_query_overrides_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.brands
    ADD CONSTRAINT brands_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.citations
    ADD CONSTRAINT citations_analysis_id_fkey FOREIGN KEY (analysis_id) REFERENCES public.response_analyses(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.citations
    ADD CONSTRAINT citations_artifact_id_fkey FOREIGN KEY (artifact_id) REFERENCES public.raw_response_artifacts(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.citations
    ADD CONSTRAINT citations_audit_id_fkey FOREIGN KEY (audit_id) REFERENCES public.audits(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.citations
    ADD CONSTRAINT citations_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.commerce_categories
    ADD CONSTRAINT commerce_categories_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.commerce_categories
    ADD CONSTRAINT commerce_categories_source_analysis_id_fkey FOREIGN KEY (source_analysis_id) REFERENCES public.site_page_analyses(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.commerce_categories
    ADD CONSTRAINT commerce_categories_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.commerce_competitor_attempts
    ADD CONSTRAINT commerce_competitor_attempts_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.commerce_competitor_attempts
    ADD CONSTRAINT commerce_competitor_attempts_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.analytics_tasks(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.commerce_competitor_attempts
    ADD CONSTRAINT commerce_competitor_attempts_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.commerce_competitor_candidates
    ADD CONSTRAINT commerce_competitor_candidates_attempt_id_fkey FOREIGN KEY (attempt_id) REFERENCES public.commerce_competitor_attempts(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.commerce_competitor_candidates
    ADD CONSTRAINT commerce_competitor_candidates_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.commerce_competitor_candidates
    ADD CONSTRAINT commerce_competitor_candidates_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.commerce_csv_imports
    ADD CONSTRAINT commerce_csv_imports_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.commerce_csv_imports
    ADD CONSTRAINT commerce_csv_imports_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.commerce_observation_citations
    ADD CONSTRAINT commerce_observation_citations_citation_id_fkey FOREIGN KEY (citation_id) REFERENCES public.citations(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.commerce_observation_citations
    ADD CONSTRAINT commerce_observation_citations_observation_id_fkey FOREIGN KEY (observation_id) REFERENCES public.commerce_recommendation_observations(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.commerce_product_categories
    ADD CONSTRAINT commerce_product_categories_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.commerce_categories(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.commerce_product_categories
    ADD CONSTRAINT commerce_product_categories_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.commerce_products(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.commerce_product_categories
    ADD CONSTRAINT commerce_product_categories_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.commerce_product_categories
    ADD CONSTRAINT commerce_product_categories_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.commerce_product_observations
    ADD CONSTRAINT commerce_product_observations_csv_import_id_fkey FOREIGN KEY (csv_import_id) REFERENCES public.commerce_csv_imports(id);

ALTER TABLE ONLY public.commerce_product_observations
    ADD CONSTRAINT commerce_product_observations_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.commerce_products(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.commerce_product_observations
    ADD CONSTRAINT commerce_product_observations_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.commerce_product_observations
    ADD CONSTRAINT commerce_product_observations_source_analysis_id_fkey FOREIGN KEY (source_analysis_id) REFERENCES public.site_page_analyses(id);

ALTER TABLE ONLY public.commerce_product_observations
    ADD CONSTRAINT commerce_product_observations_source_artifact_id_fkey FOREIGN KEY (source_artifact_id) REFERENCES public.site_fetch_artifacts(id);

ALTER TABLE ONLY public.commerce_product_observations
    ADD CONSTRAINT commerce_product_observations_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.commerce_products
    ADD CONSTRAINT commerce_products_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.commerce_products
    ADD CONSTRAINT commerce_products_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.commerce_prompt_targets
    ADD CONSTRAINT commerce_prompt_targets_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.commerce_prompt_targets
    ADD CONSTRAINT commerce_prompt_targets_prompt_id_fkey FOREIGN KEY (prompt_id) REFERENCES public.prompts(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.commerce_prompt_targets
    ADD CONSTRAINT commerce_prompt_targets_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.commerce_recommendation_observations
    ADD CONSTRAINT commerce_recommendation_observatio_competitor_candidate_id_fkey FOREIGN KEY (competitor_candidate_id) REFERENCES public.commerce_competitor_candidates(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.commerce_recommendation_observations
    ADD CONSTRAINT commerce_recommendation_observations_artifact_id_fkey FOREIGN KEY (artifact_id) REFERENCES public.raw_response_artifacts(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.commerce_recommendation_observations
    ADD CONSTRAINT commerce_recommendation_observations_audit_id_fkey FOREIGN KEY (audit_id) REFERENCES public.audits(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.commerce_recommendation_observations
    ADD CONSTRAINT commerce_recommendation_observations_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.commerce_products(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.commerce_recommendation_observations
    ADD CONSTRAINT commerce_recommendation_observations_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.commerce_recommendation_observations
    ADD CONSTRAINT commerce_recommendation_observations_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.audit_tasks(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.commerce_recommendation_observations
    ADD CONSTRAINT commerce_recommendation_observations_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.commerce_shelf_snapshots
    ADD CONSTRAINT commerce_shelf_snapshots_audit_id_fkey FOREIGN KEY (audit_id) REFERENCES public.audits(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.commerce_shelf_snapshots
    ADD CONSTRAINT commerce_shelf_snapshots_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.commerce_shelf_snapshots
    ADD CONSTRAINT commerce_shelf_snapshots_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.competitor_mentions
    ADD CONSTRAINT competitor_mentions_analysis_id_fkey FOREIGN KEY (analysis_id) REFERENCES public.response_analyses(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.competitor_mentions
    ADD CONSTRAINT competitor_mentions_artifact_id_fkey FOREIGN KEY (artifact_id) REFERENCES public.raw_response_artifacts(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.competitor_mentions
    ADD CONSTRAINT competitor_mentions_audit_id_fkey FOREIGN KEY (audit_id) REFERENCES public.audits(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.competitor_mentions
    ADD CONSTRAINT competitor_mentions_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.competitors
    ADD CONSTRAINT competitors_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.consumable_ledger
    ADD CONSTRAINT consumable_ledger_billing_account_id_fkey FOREIGN KEY (billing_account_id) REFERENCES public.billing_accounts(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.consumable_ledger
    ADD CONSTRAINT consumable_ledger_grant_id_fkey FOREIGN KEY (grant_id) REFERENCES public.account_grants(id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.consumable_ledger
    ADD CONSTRAINT consumable_ledger_refund_of_id_fkey FOREIGN KEY (refund_of_id) REFERENCES public.consumable_ledger(id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.consumable_ledger
    ADD CONSTRAINT consumable_ledger_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.platform_calls
    ADD CONSTRAINT platform_calls_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.platform_calls
    ADD CONSTRAINT platform_calls_billing_account_id_fkey FOREIGN KEY (billing_account_id) REFERENCES public.billing_accounts(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.content_differentiation_candidates
    ADD CONSTRAINT content_differentiation_candidates_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.content_differentiation_candidates
    ADD CONSTRAINT content_differentiation_candidates_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.content_differentiation_reports
    ADD CONSTRAINT content_differentiation_reports_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.content_differentiation_reports
    ADD CONSTRAINT content_differentiation_reports_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.crawl_log_batches
    ADD CONSTRAINT crawl_log_batches_workspace_id_project_id_fkey FOREIGN KEY (workspace_id, project_id) REFERENCES public.projects(workspace_id, id) ON DELETE CASCADE;

ALTER TABLE ONLY public.crawl_log_batches
    ADD CONSTRAINT crawl_log_batches_workspace_id_project_id_source_id_fkey FOREIGN KEY (workspace_id, project_id, source_id) REFERENCES public.crawl_log_sources(workspace_id, project_id, id) ON DELETE CASCADE;

ALTER TABLE ONLY public.crawl_log_batches
    ADD CONSTRAINT crawl_log_batches_workspace_id_project_id_upload_id_fkey FOREIGN KEY (workspace_id, project_id, upload_id) REFERENCES public.crawl_log_uploads(workspace_id, project_id, id) ON DELETE CASCADE;

ALTER TABLE ONLY public.crawl_log_coverage_daily
    ADD CONSTRAINT crawl_log_coverage_daily_workspace_id_project_id_fkey FOREIGN KEY (workspace_id, project_id) REFERENCES public.projects(workspace_id, id) ON DELETE CASCADE;

ALTER TABLE ONLY public.crawl_log_coverage_daily
    ADD CONSTRAINT crawl_log_coverage_daily_workspace_id_project_id_source_id_fkey FOREIGN KEY (workspace_id, project_id, source_id) REFERENCES public.crawl_log_sources(workspace_id, project_id, id) ON DELETE CASCADE;

ALTER TABLE ONLY public.crawl_log_sources
    ADD CONSTRAINT crawl_log_sources_workspace_id_project_id_fkey FOREIGN KEY (workspace_id, project_id) REFERENCES public.projects(workspace_id, id) ON DELETE CASCADE;

ALTER TABLE ONLY public.crawl_log_states
    ADD CONSTRAINT crawl_log_states_workspace_id_project_id_fkey FOREIGN KEY (workspace_id, project_id) REFERENCES public.projects(workspace_id, id) ON DELETE CASCADE;

ALTER TABLE ONLY public.crawl_log_uploads
    ADD CONSTRAINT crawl_log_uploads_workspace_id_project_id_fkey FOREIGN KEY (workspace_id, project_id) REFERENCES public.projects(workspace_id, id) ON DELETE CASCADE;

ALTER TABLE ONLY public.crawl_log_uploads
    ADD CONSTRAINT crawl_log_uploads_workspace_id_project_id_source_id_fkey FOREIGN KEY (workspace_id, project_id, source_id) REFERENCES public.crawl_log_sources(workspace_id, project_id, id) ON DELETE CASCADE;

ALTER TABLE ONLY public.demand_signals
    ADD CONSTRAINT demand_signals_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.demand_signals
    ADD CONSTRAINT demand_signals_snapshot_id_fkey FOREIGN KEY (snapshot_id) REFERENCES public.demand_snapshots(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.demand_signals
    ADD CONSTRAINT demand_signals_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.demand_snapshots
    ADD CONSTRAINT demand_snapshots_prior_snapshot_id_fkey FOREIGN KEY (prior_snapshot_id) REFERENCES public.demand_snapshots(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.demand_snapshots
    ADD CONSTRAINT demand_snapshots_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.demand_snapshots
    ADD CONSTRAINT demand_snapshots_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.execution_cost_projections
    ADD CONSTRAINT execution_cost_projections_audit_id_fkey FOREIGN KEY (audit_id) REFERENCES public.audits(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.execution_cost_projections
    ADD CONSTRAINT execution_cost_projections_raw_response_artifact_id_fkey FOREIGN KEY (raw_response_artifact_id) REFERENCES public.raw_response_artifacts(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.execution_cost_projections
    ADD CONSTRAINT execution_cost_projections_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.audit_tasks(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.audit_tasks
    ADD CONSTRAINT fk_audit_tasks_result_artifact_id FOREIGN KEY (result_artifact_id) REFERENCES public.raw_response_artifacts(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.audit_tasks
    ADD CONSTRAINT fk_audit_tasks_source_task_id FOREIGN KEY (source_task_id) REFERENCES public.audit_tasks(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.audits
    ADD CONSTRAINT fk_audits_parent_audit_id FOREIGN KEY (parent_audit_id) REFERENCES public.audits(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.audits
    ADD CONSTRAINT fk_audits_schedule_id FOREIGN KEY (schedule_id) REFERENCES public.audit_schedules(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.brands
    ADD CONSTRAINT fk_brands_logo_asset_id_brand_logo_assets FOREIGN KEY (logo_asset_id) REFERENCES public.brand_logo_assets(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.competitors
    ADD CONSTRAINT fk_competitors_logo_asset_id_brand_logo_assets FOREIGN KEY (logo_asset_id) REFERENCES public.brand_logo_assets(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.content_differentiation_candidates
    ADD CONSTRAINT fk_content_diff_candidates_audit FOREIGN KEY (workspace_id, project_id, audit_id) REFERENCES public.audits(workspace_id, project_id, id) ON DELETE CASCADE;

ALTER TABLE ONLY public.content_differentiation_candidates
    ADD CONSTRAINT fk_content_diff_candidates_source_page FOREIGN KEY (workspace_id, project_id, source_page_id) REFERENCES public.source_pages(workspace_id, project_id, id) ON DELETE CASCADE;

ALTER TABLE ONLY public.content_differentiation_candidates
    ADD CONSTRAINT fk_content_diff_candidates_task FOREIGN KEY (workspace_id, project_id, audit_id, audit_task_id) REFERENCES public.audit_tasks(workspace_id, project_id, audit_id, id) ON DELETE CASCADE;

ALTER TABLE ONLY public.content_differentiation_reports
    ADD CONSTRAINT fk_content_diff_reports_audit FOREIGN KEY (workspace_id, project_id, audit_id) REFERENCES public.audits(workspace_id, project_id, id) ON DELETE CASCADE;

ALTER TABLE ONLY public.content_differentiation_reports
    ADD CONSTRAINT fk_content_diff_reports_owned_site_url FOREIGN KEY (owned_site_url_id, project_id, workspace_id) REFERENCES public.site_urls(id, project_id, workspace_id) ON DELETE SET NULL (owned_site_url_id);

ALTER TABLE ONLY public.content_differentiation_reports
    ADD CONSTRAINT fk_content_diff_reports_task FOREIGN KEY (workspace_id, project_id, audit_id, audit_task_id) REFERENCES public.audit_tasks(workspace_id, project_id, audit_id, id) ON DELETE CASCADE;

ALTER TABLE ONLY public.integration_import_artifacts
    ADD CONSTRAINT fk_integration_artifact_connection_scoped FOREIGN KEY (workspace_id, connection_id) REFERENCES public.integration_connections(workspace_id, id) ON DELETE CASCADE;

ALTER TABLE ONLY public.integration_import_artifacts
    ADD CONSTRAINT fk_integration_artifact_sync_run_scoped FOREIGN KEY (workspace_id, sync_run_id) REFERENCES public.integration_sync_runs(workspace_id, id) ON DELETE CASCADE;

ALTER TABLE ONLY public.integration_connections
    ADD CONSTRAINT fk_integration_connection_grant_scoped FOREIGN KEY (workspace_id, grant_id) REFERENCES public.integration_oauth_grants(workspace_id, id) ON DELETE CASCADE;

ALTER TABLE ONLY public.integration_property_mappings
    ADD CONSTRAINT fk_integration_mapping_connection_scoped FOREIGN KEY (workspace_id, connection_id) REFERENCES public.integration_connections(workspace_id, id) ON DELETE CASCADE;

ALTER TABLE ONLY public.integration_metric_rows
    ADD CONSTRAINT fk_integration_metric_row_artifact_scoped FOREIGN KEY (workspace_id, source_artifact_id) REFERENCES public.integration_import_artifacts(workspace_id, id) ON DELETE CASCADE;

ALTER TABLE ONLY public.integration_sync_runs
    ADD CONSTRAINT fk_integration_sync_run_connection_scoped FOREIGN KEY (workspace_id, connection_id) REFERENCES public.integration_connections(workspace_id, id) ON DELETE CASCADE;

ALTER TABLE ONLY public.opportunities
    ADD CONSTRAINT fk_opportunities_action_id FOREIGN KEY (action_id) REFERENCES public.actions(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.opportunity_implementation_events
    ADD CONSTRAINT fk_opportunity_implementation_output_revision_id FOREIGN KEY (output_revision_id) REFERENCES public.agent_output_revisions(id);

ALTER TABLE ONLY public.opportunity_snapshots
    ADD CONSTRAINT fk_opportunity_snapshots_demand_snapshot_id FOREIGN KEY (demand_snapshot_id) REFERENCES public.demand_snapshots(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.opportunity_verification_events
    ADD CONSTRAINT fk_opportunity_verification_implementation_workspace FOREIGN KEY (workspace_id, implementation_event_id) REFERENCES public.opportunity_implementation_events(workspace_id, id) ON DELETE CASCADE;

ALTER TABLE ONLY public.performance_dimension_stats
    ADD CONSTRAINT fk_performance_dimension_stat_snapshot_scoped FOREIGN KEY (workspace_id, project_id, snapshot_id) REFERENCES public.traffic_snapshots(workspace_id, project_id, id) ON DELETE CASCADE;

ALTER TABLE ONLY public.referral_classifications
    ADD CONSTRAINT fk_referral_classification_event_scoped FOREIGN KEY (workspace_id, referral_event_id) REFERENCES public.referral_events(workspace_id, id) ON DELETE CASCADE;

ALTER TABLE ONLY public.referral_events
    ADD CONSTRAINT fk_referral_event_import_scoped FOREIGN KEY (workspace_id, import_id) REFERENCES public.integration_import_artifacts(workspace_id, id) ON DELETE CASCADE;

ALTER TABLE ONLY public.search_intelligence_calls
    ADD CONSTRAINT fk_si_call_dataset_scope FOREIGN KEY (workspace_id, project_id, dataset_id) REFERENCES public.search_intelligence_datasets(workspace_id, project_id, id) ON DELETE CASCADE;

ALTER TABLE ONLY public.search_intelligence_calls
    ADD CONSTRAINT fk_si_call_run_scope FOREIGN KEY (workspace_id, project_id, run_id) REFERENCES public.search_intelligence_runs(workspace_id, project_id, id) ON DELETE CASCADE;

ALTER TABLE ONLY public.search_intelligence_datasets
    ADD CONSTRAINT fk_si_dataset_run_scope FOREIGN KEY (workspace_id, project_id, run_id) REFERENCES public.search_intelligence_runs(workspace_id, project_id, id) ON DELETE CASCADE;

ALTER TABLE ONLY public.search_intelligence_dispatch_attempts
    ADD CONSTRAINT fk_si_dispatch_call_scope FOREIGN KEY (workspace_id, project_id, call_id) REFERENCES public.search_intelligence_calls(workspace_id, project_id, id) ON DELETE CASCADE;

ALTER TABLE ONLY public.search_intelligence_rows
    ADD CONSTRAINT fk_si_row_dataset_scope FOREIGN KEY (workspace_id, project_id, dataset_id) REFERENCES public.search_intelligence_datasets(workspace_id, project_id, id) ON DELETE CASCADE;

ALTER TABLE ONLY public.site_change_observations
    ADD CONSTRAINT fk_site_change_observation_implementation_workspace FOREIGN KEY (workspace_id, implementation_event_id) REFERENCES public.opportunity_implementation_events(workspace_id, id);

ALTER TABLE ONLY public.site_change_observations
    ADD CONSTRAINT fk_site_change_observation_snapshot_workspace FOREIGN KEY (workspace_id, snapshot_id) REFERENCES public.site_change_snapshots(workspace_id, id) ON DELETE CASCADE;

ALTER TABLE ONLY public.site_change_snapshots
    ADD CONSTRAINT fk_site_change_snapshot_crawl_a_scoped FOREIGN KEY (crawl_a_id, project_id, workspace_id) REFERENCES public.site_crawls(id, project_id, workspace_id) ON DELETE CASCADE;

ALTER TABLE ONLY public.site_change_snapshots
    ADD CONSTRAINT fk_site_change_snapshot_crawl_b_scoped FOREIGN KEY (crawl_b_id, project_id, workspace_id) REFERENCES public.site_crawls(id, project_id, workspace_id) ON DELETE CASCADE;

ALTER TABLE ONLY public.site_crawl_tasks
    ADD CONSTRAINT fk_site_crawl_tasks_result_artifact_id FOREIGN KEY (result_artifact_id) REFERENCES public.site_fetch_artifacts(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.site_observed_architectures
    ADD CONSTRAINT fk_site_observed_architecture_crawl_scoped FOREIGN KEY (workspace_id, project_id, crawl_id) REFERENCES public.site_crawls(workspace_id, project_id, id) ON DELETE CASCADE;

ALTER TABLE ONLY public.site_page_link_metrics
    ADD CONSTRAINT fk_site_page_link_metric_crawl_scoped FOREIGN KEY (workspace_id, project_id, crawl_id) REFERENCES public.site_crawls(workspace_id, project_id, id) ON DELETE CASCADE;

ALTER TABLE ONLY public.site_page_link_metrics
    ADD CONSTRAINT fk_site_page_link_metric_site_url_scoped FOREIGN KEY (workspace_id, project_id, site_url_id) REFERENCES public.site_urls(workspace_id, project_id, id) ON DELETE CASCADE;

ALTER TABLE ONLY public.site_url_observations
    ADD CONSTRAINT fk_site_url_observation_crawl_scoped FOREIGN KEY (workspace_id, project_id, crawl_id) REFERENCES public.site_crawls(workspace_id, project_id, id) ON DELETE CASCADE;

ALTER TABLE ONLY public.site_url_observations
    ADD CONSTRAINT fk_site_url_observation_site_url_scoped FOREIGN KEY (workspace_id, project_id, site_url_id) REFERENCES public.site_urls(workspace_id, project_id, id) ON DELETE CASCADE;

ALTER TABLE ONLY public.source_pages
    ADD CONSTRAINT fk_source_pages_latest_snapshot FOREIGN KEY (latest_snapshot_id) REFERENCES public.source_page_snapshots(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.traffic_page_stats
    ADD CONSTRAINT fk_traffic_page_stat_snapshot_scoped FOREIGN KEY (workspace_id, snapshot_id) REFERENCES public.traffic_snapshots(workspace_id, id) ON DELETE CASCADE;

ALTER TABLE ONLY public.traffic_query_stats
    ADD CONSTRAINT fk_traffic_query_stat_snapshot_scoped FOREIGN KEY (workspace_id, snapshot_id) REFERENCES public.traffic_snapshots(workspace_id, id) ON DELETE CASCADE;

ALTER TABLE ONLY public.grant_revocations
    ADD CONSTRAINT grant_revocations_actor_user_id_fkey FOREIGN KEY (actor_user_id) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.grant_revocations
    ADD CONSTRAINT grant_revocations_grant_id_fkey FOREIGN KEY (grant_id) REFERENCES public.account_grants(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.idempotency_records
    ADD CONSTRAINT idempotency_records_billing_account_id_fkey FOREIGN KEY (billing_account_id) REFERENCES public.billing_accounts(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.integration_connections
    ADD CONSTRAINT integration_connections_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.integration_events
    ADD CONSTRAINT integration_events_connection_id_fkey FOREIGN KEY (connection_id) REFERENCES public.integration_connections(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.integration_events
    ADD CONSTRAINT integration_events_grant_id_fkey FOREIGN KEY (grant_id) REFERENCES public.integration_oauth_grants(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.integration_events
    ADD CONSTRAINT integration_events_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.integration_import_artifacts
    ADD CONSTRAINT integration_import_artifacts_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.integration_metric_rows
    ADD CONSTRAINT integration_metric_rows_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.integration_metric_rows
    ADD CONSTRAINT integration_metric_rows_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.integration_oauth_grants
    ADD CONSTRAINT integration_oauth_grants_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.integration_oauth_states
    ADD CONSTRAINT integration_oauth_states_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.integration_oauth_states
    ADD CONSTRAINT integration_oauth_states_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.integration_property_mappings
    ADD CONSTRAINT integration_property_mappings_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.integration_property_mappings
    ADD CONSTRAINT integration_property_mappings_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.integration_sync_runs
    ADD CONSTRAINT integration_sync_runs_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.integration_sync_runs
    ADD CONSTRAINT integration_sync_runs_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.introductory_claims
    ADD CONSTRAINT introductory_claims_billing_account_id_fkey FOREIGN KEY (billing_account_id) REFERENCES public.billing_accounts(id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.introductory_claims
    ADD CONSTRAINT introductory_claims_consented_by_user_id_fkey FOREIGN KEY (consented_by_user_id) REFERENCES public.users(id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.introductory_claims
    ADD CONSTRAINT introductory_claims_ended_by_user_id_fkey FOREIGN KEY (ended_by_user_id) REFERENCES public.users(id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.introductory_claims
    ADD CONSTRAINT introductory_claims_operator_code_id_fkey FOREIGN KEY (operator_code_id) REFERENCES public.introductory_operator_codes(id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.introductory_claims
    ADD CONSTRAINT introductory_claims_primary_grant_id_fkey FOREIGN KEY (primary_grant_id) REFERENCES public.account_grants(id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.introductory_operator_codes
    ADD CONSTRAINT introductory_operator_codes_billing_account_id_fkey FOREIGN KEY (billing_account_id) REFERENCES public.billing_accounts(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.introductory_operator_codes
    ADD CONSTRAINT introductory_operator_codes_created_by_user_id_fkey FOREIGN KEY (created_by_user_id) REFERENCES public.users(id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.mcp_authorization_codes
    ADD CONSTRAINT mcp_authorization_codes_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.mcp_oauth_clients(client_id) ON DELETE CASCADE;

ALTER TABLE ONLY public.mcp_authorization_codes
    ADD CONSTRAINT mcp_authorization_codes_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.mcp_authorization_requests
    ADD CONSTRAINT mcp_authorization_requests_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.mcp_oauth_clients(client_id) ON DELETE CASCADE;

ALTER TABLE ONLY public.mcp_confirmations
    ADD CONSTRAINT mcp_confirmations_grant_id_fkey FOREIGN KEY (grant_id) REFERENCES public.mcp_oauth_grants(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.mcp_confirmations
    ADD CONSTRAINT mcp_confirmations_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.mcp_confirmations
    ADD CONSTRAINT mcp_confirmations_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.mcp_confirmations
    ADD CONSTRAINT mcp_confirmations_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.mcp_oauth_grants
    ADD CONSTRAINT mcp_oauth_grants_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.mcp_oauth_clients(client_id) ON DELETE CASCADE;

ALTER TABLE ONLY public.mcp_oauth_grants
    ADD CONSTRAINT mcp_oauth_grants_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.metric_snapshots
    ADD CONSTRAINT metric_snapshots_audit_id_fkey FOREIGN KEY (audit_id) REFERENCES public.audits(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.metric_snapshots
    ADD CONSTRAINT metric_snapshots_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.metric_snapshots
    ADD CONSTRAINT metric_snapshots_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.monitored_site_urls
    ADD CONSTRAINT monitored_site_urls_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES public.site_health_profiles(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.monitored_site_urls
    ADD CONSTRAINT monitored_site_urls_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.monitored_site_urls
    ADD CONSTRAINT monitored_site_urls_site_url_id_fkey FOREIGN KEY (site_url_id) REFERENCES public.site_urls(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.monitored_site_urls
    ADD CONSTRAINT monitored_site_urls_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.observed_entity_candidates
    ADD CONSTRAINT observed_entity_candidates_audit_id_fkey FOREIGN KEY (audit_id) REFERENCES public.audits(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.observed_entity_candidates
    ADD CONSTRAINT observed_entity_candidates_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.observed_entity_candidates
    ADD CONSTRAINT observed_entity_candidates_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.opportunities
    ADD CONSTRAINT opportunities_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.opportunities
    ADD CONSTRAINT opportunities_superseded_by_id_fkey FOREIGN KEY (superseded_by_id) REFERENCES public.opportunities(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.opportunities
    ADD CONSTRAINT opportunities_target_prompt_id_fkey FOREIGN KEY (target_prompt_id) REFERENCES public.prompts(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.opportunities
    ADD CONSTRAINT opportunities_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.opportunity_implementation_events
    ADD CONSTRAINT opportunity_implementation_events_action_id_fkey FOREIGN KEY (action_id) REFERENCES public.actions(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.opportunity_implementation_events
    ADD CONSTRAINT opportunity_implementation_events_actor_user_id_fkey FOREIGN KEY (actor_user_id) REFERENCES public.users(id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.opportunity_implementation_events
    ADD CONSTRAINT opportunity_implementation_events_opportunity_snapshot_id_fkey FOREIGN KEY (opportunity_snapshot_id) REFERENCES public.opportunity_snapshots(id);

ALTER TABLE ONLY public.opportunity_implementation_events
    ADD CONSTRAINT opportunity_implementation_events_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.opportunity_implementation_events
    ADD CONSTRAINT opportunity_implementation_events_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.opportunity_orders
    ADD CONSTRAINT opportunity_orders_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.opportunity_orders
    ADD CONSTRAINT opportunity_orders_updated_by_user_id_fkey FOREIGN KEY (updated_by_user_id) REFERENCES public.users(id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.opportunity_orders
    ADD CONSTRAINT opportunity_orders_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.opportunity_snapshots
    ADD CONSTRAINT opportunity_snapshots_audit_id_fkey FOREIGN KEY (audit_id) REFERENCES public.audits(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.opportunity_snapshots
    ADD CONSTRAINT opportunity_snapshots_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.opportunity_snapshots
    ADD CONSTRAINT opportunity_snapshots_site_crawl_id_fkey FOREIGN KEY (site_crawl_id) REFERENCES public.site_crawls(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.opportunity_snapshots
    ADD CONSTRAINT opportunity_snapshots_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.opportunity_verification_events
    ADD CONSTRAINT opportunity_verification_events_audit_id_fkey FOREIGN KEY (audit_id) REFERENCES public.audits(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.opportunity_verification_events
    ADD CONSTRAINT opportunity_verification_events_crawl_id_fkey FOREIGN KEY (crawl_id) REFERENCES public.site_crawls(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.opportunity_verification_events
    ADD CONSTRAINT opportunity_verification_events_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.opportunity_verification_events
    ADD CONSTRAINT opportunity_verification_events_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.overview_layouts
    ADD CONSTRAINT overview_layouts_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.overview_layouts
    ADD CONSTRAINT overview_layouts_updated_by_user_id_fkey FOREIGN KEY (updated_by_user_id) REFERENCES public.users(id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.overview_layouts
    ADD CONSTRAINT overview_layouts_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.owned_domains
    ADD CONSTRAINT owned_domains_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.project_markets
    ADD CONSTRAINT project_markets_workspace_id_project_id_fkey FOREIGN KEY (workspace_id, project_id) REFERENCES public.projects(workspace_id, id) ON DELETE CASCADE;

ALTER TABLE ONLY public.pending_activations
    ADD CONSTRAINT pending_activations_billing_account_id_fkey FOREIGN KEY (billing_account_id) REFERENCES public.billing_accounts(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.performance_dimension_stats
    ADD CONSTRAINT performance_dimension_stats_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.performance_dimension_stats
    ADD CONSTRAINT performance_dimension_stats_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.projects
    ADD CONSTRAINT projects_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.prompt_candidates
    ADD CONSTRAINT prompt_candidates_prompt_id_fkey FOREIGN KEY (prompt_id) REFERENCES public.prompts(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.prompt_candidates
    ADD CONSTRAINT prompt_candidates_prompt_set_id_fkey FOREIGN KEY (prompt_set_id) REFERENCES public.prompt_sets(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.prompt_candidates
    ADD CONSTRAINT prompt_candidates_run_id_fkey FOREIGN KEY (run_id) REFERENCES public.prompt_generation_runs(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.prompt_candidates
    ADD CONSTRAINT prompt_candidates_topic_id_fkey FOREIGN KEY (topic_id) REFERENCES public.topics(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.prompt_candidates
    ADD CONSTRAINT prompt_candidates_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.prompt_generation_runs
    ADD CONSTRAINT prompt_generation_runs_prompt_set_id_fkey FOREIGN KEY (prompt_set_id) REFERENCES public.prompt_sets(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.prompt_generation_runs
    ADD CONSTRAINT prompt_generation_runs_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.prompt_generation_runs
    ADD CONSTRAINT prompt_generation_runs_workspace_id_project_id_fkey FOREIGN KEY (workspace_id, project_id) REFERENCES public.projects(workspace_id, id) ON DELETE CASCADE;

ALTER TABLE ONLY public.prompt_metric_snapshots
    ADD CONSTRAINT prompt_metric_snapshots_audit_id_fkey FOREIGN KEY (audit_id) REFERENCES public.audits(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.prompt_metric_snapshots
    ADD CONSTRAINT prompt_metric_snapshots_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.prompt_metric_snapshots
    ADD CONSTRAINT prompt_metric_snapshots_prompt_id_fkey FOREIGN KEY (prompt_id) REFERENCES public.prompts(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.prompt_metric_snapshots
    ADD CONSTRAINT prompt_metric_snapshots_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.prompt_sets
    ADD CONSTRAINT prompt_sets_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.prompts
    ADD CONSTRAINT prompts_prompt_set_id_fkey FOREIGN KEY (prompt_set_id) REFERENCES public.prompt_sets(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.prompts
    ADD CONSTRAINT prompts_topic_id_fkey FOREIGN KEY (topic_id) REFERENCES public.topics(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.provider_attempts
    ADD CONSTRAINT provider_attempts_artifact_id_fkey FOREIGN KEY (artifact_id) REFERENCES public.raw_response_artifacts(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.provider_attempts
    ADD CONSTRAINT provider_attempts_audit_id_fkey FOREIGN KEY (audit_id) REFERENCES public.audits(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.provider_attempts
    ADD CONSTRAINT provider_attempts_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.audit_tasks(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.provider_capacity_buckets
    ADD CONSTRAINT provider_capacity_buckets_billing_account_id_fkey FOREIGN KEY (billing_account_id) REFERENCES public.billing_accounts(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.provider_capacity_buckets
    ADD CONSTRAINT provider_capacity_buckets_connection_id_fkey FOREIGN KEY (connection_id) REFERENCES public.provider_connections(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.provider_capacity_leases
    ADD CONSTRAINT provider_capacity_leases_analytics_task_id_fkey FOREIGN KEY (analytics_task_id) REFERENCES public.analytics_tasks(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.provider_capacity_leases
    ADD CONSTRAINT provider_capacity_leases_bucket_id_fkey FOREIGN KEY (bucket_id) REFERENCES public.provider_capacity_buckets(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.provider_capacity_leases
    ADD CONSTRAINT provider_capacity_leases_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.audit_tasks(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.provider_connection_tests
    ADD CONSTRAINT provider_connection_tests_connection_id_fkey FOREIGN KEY (connection_id) REFERENCES public.provider_connections(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.provider_connection_tests
    ADD CONSTRAINT provider_connection_tests_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.provider_connections
    ADD CONSTRAINT provider_connections_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.provider_routes
    ADD CONSTRAINT provider_routes_connection_id_fkey FOREIGN KEY (connection_id) REFERENCES public.provider_connections(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.provider_routes
    ADD CONSTRAINT provider_routes_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.query_evidence_rows
    ADD CONSTRAINT query_evidence_rows_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.query_evidence_rows
    ADD CONSTRAINT query_evidence_rows_site_url_id_fkey FOREIGN KEY (site_url_id) REFERENCES public.site_urls(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.query_evidence_rows
    ADD CONSTRAINT query_evidence_rows_snapshot_id_fkey FOREIGN KEY (snapshot_id) REFERENCES public.query_evidence_snapshots(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.query_evidence_rows
    ADD CONSTRAINT query_evidence_rows_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.query_evidence_snapshots
    ADD CONSTRAINT query_evidence_snapshots_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.query_evidence_snapshots
    ADD CONSTRAINT query_evidence_snapshots_supersedes_snapshot_id_fkey FOREIGN KEY (supersedes_snapshot_id) REFERENCES public.query_evidence_snapshots(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.query_evidence_snapshots
    ADD CONSTRAINT query_evidence_snapshots_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.queue_workspace_turns
    ADD CONSTRAINT queue_workspace_turns_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.raw_response_artifacts
    ADD CONSTRAINT raw_response_artifacts_audit_id_fkey FOREIGN KEY (audit_id) REFERENCES public.audits(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.raw_response_artifacts
    ADD CONSTRAINT raw_response_artifacts_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.audit_tasks(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.referral_classifications
    ADD CONSTRAINT referral_classifications_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.referral_classifications
    ADD CONSTRAINT referral_classifications_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.referral_events
    ADD CONSTRAINT referral_events_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.referral_events
    ADD CONSTRAINT referral_events_source_metric_row_id_fkey FOREIGN KEY (source_metric_row_id) REFERENCES public.integration_metric_rows(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.referral_events
    ADD CONSTRAINT referral_events_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.response_analyses
    ADD CONSTRAINT response_analyses_artifact_id_fkey FOREIGN KEY (artifact_id) REFERENCES public.raw_response_artifacts(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.response_analyses
    ADD CONSTRAINT response_analyses_audit_id_fkey FOREIGN KEY (audit_id) REFERENCES public.audits(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.response_analyses
    ADD CONSTRAINT response_analyses_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.audit_tasks(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.response_analyses
    ADD CONSTRAINT response_analyses_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.retrieved_sources
    ADD CONSTRAINT retrieved_sources_analysis_id_fkey FOREIGN KEY (analysis_id) REFERENCES public.response_analyses(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.retrieved_sources
    ADD CONSTRAINT retrieved_sources_artifact_id_fkey FOREIGN KEY (artifact_id) REFERENCES public.raw_response_artifacts(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.retrieved_sources
    ADD CONSTRAINT retrieved_sources_audit_id_fkey FOREIGN KEY (audit_id) REFERENCES public.audits(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.retrieved_sources
    ADD CONSTRAINT retrieved_sources_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.robots_snapshots
    ADD CONSTRAINT robots_snapshots_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.robots_snapshots
    ADD CONSTRAINT robots_snapshots_workspace_id_project_id_fkey FOREIGN KEY (workspace_id, project_id) REFERENCES public.projects(workspace_id, id) ON DELETE CASCADE;

ALTER TABLE ONLY public.search_intelligence_datasets
    ADD CONSTRAINT search_intelligence_datasets_parent_dataset_id_fkey FOREIGN KEY (parent_dataset_id) REFERENCES public.search_intelligence_datasets(id);

ALTER TABLE ONLY public.search_intelligence_rows
    ADD CONSTRAINT search_intelligence_rows_call_id_fkey FOREIGN KEY (call_id) REFERENCES public.search_intelligence_calls(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.search_intelligence_runs
    ADD CONSTRAINT search_intelligence_runs_actor_user_id_fkey FOREIGN KEY (actor_user_id) REFERENCES public.users(id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.search_intelligence_runs
    ADD CONSTRAINT search_intelligence_runs_analytics_task_id_fkey FOREIGN KEY (analytics_task_id) REFERENCES public.analytics_tasks(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.search_intelligence_runs
    ADD CONSTRAINT search_intelligence_runs_connection_id_fkey FOREIGN KEY (connection_id) REFERENCES public.provider_connections(id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.search_intelligence_runs
    ADD CONSTRAINT search_intelligence_runs_platform_call_id_fkey FOREIGN KEY (platform_call_id) REFERENCES public.platform_calls(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.search_intelligence_runs
    ADD CONSTRAINT search_intelligence_runs_previous_run_id_fkey FOREIGN KEY (previous_run_id) REFERENCES public.search_intelligence_runs(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.search_intelligence_runs
    ADD CONSTRAINT search_intelligence_runs_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.search_intelligence_runs
    ADD CONSTRAINT search_intelligence_runs_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.site_change_observations
    ADD CONSTRAINT site_change_observations_site_url_id_fkey FOREIGN KEY (site_url_id) REFERENCES public.site_urls(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.site_change_observations
    ADD CONSTRAINT site_change_observations_source_analysis_a_id_fkey FOREIGN KEY (source_analysis_a_id) REFERENCES public.site_page_analyses(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.site_change_observations
    ADD CONSTRAINT site_change_observations_source_analysis_b_id_fkey FOREIGN KEY (source_analysis_b_id) REFERENCES public.site_page_analyses(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.site_change_observations
    ADD CONSTRAINT site_change_observations_source_artifact_a_id_fkey FOREIGN KEY (source_artifact_a_id) REFERENCES public.site_fetch_artifacts(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.site_change_observations
    ADD CONSTRAINT site_change_observations_source_artifact_b_id_fkey FOREIGN KEY (source_artifact_b_id) REFERENCES public.site_fetch_artifacts(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.site_change_observations
    ADD CONSTRAINT site_change_observations_source_evaluation_a_id_fkey FOREIGN KEY (source_evaluation_a_id) REFERENCES public.site_rule_evaluations(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.site_change_observations
    ADD CONSTRAINT site_change_observations_source_evaluation_b_id_fkey FOREIGN KEY (source_evaluation_b_id) REFERENCES public.site_rule_evaluations(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.site_change_observations
    ADD CONSTRAINT site_change_observations_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.site_change_snapshots
    ADD CONSTRAINT site_change_snapshots_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.site_change_snapshots
    ADD CONSTRAINT site_change_snapshots_supersedes_id_fkey FOREIGN KEY (supersedes_id) REFERENCES public.site_change_snapshots(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.site_change_snapshots
    ADD CONSTRAINT site_change_snapshots_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.site_crawl_events
    ADD CONSTRAINT site_crawl_events_crawl_id_fkey FOREIGN KEY (crawl_id) REFERENCES public.site_crawls(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.site_crawl_tasks
    ADD CONSTRAINT site_crawl_tasks_crawl_id_fkey FOREIGN KEY (crawl_id) REFERENCES public.site_crawls(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.site_crawl_tasks
    ADD CONSTRAINT site_crawl_tasks_parent_site_url_id_fkey FOREIGN KEY (parent_site_url_id) REFERENCES public.site_urls(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.site_crawl_tasks
    ADD CONSTRAINT site_crawl_tasks_site_url_id_fkey FOREIGN KEY (site_url_id) REFERENCES public.site_urls(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.site_crawl_tasks
    ADD CONSTRAINT site_crawl_tasks_source_task_id_fkey FOREIGN KEY (source_task_id) REFERENCES public.site_crawl_tasks(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.site_crawl_tasks
    ADD CONSTRAINT site_crawl_tasks_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.site_crawls
    ADD CONSTRAINT site_crawls_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES public.site_health_profiles(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.site_crawls
    ADD CONSTRAINT site_crawls_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.site_crawls
    ADD CONSTRAINT site_crawls_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.site_crawls
    ADD CONSTRAINT site_crawls_workspace_id_project_id_robots_snapshot_id_fkey FOREIGN KEY (workspace_id, project_id, robots_snapshot_id) REFERENCES public.robots_snapshots(workspace_id, project_id, id);

ALTER TABLE ONLY public.site_discovery_frontier
    ADD CONSTRAINT site_discovery_frontier_crawl_id_fkey FOREIGN KEY (crawl_id) REFERENCES public.site_crawls(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.site_discovery_frontier
    ADD CONSTRAINT site_discovery_frontier_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.site_fetch_artifacts
    ADD CONSTRAINT site_fetch_artifacts_crawl_id_fkey FOREIGN KEY (crawl_id) REFERENCES public.site_crawls(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.site_fetch_artifacts
    ADD CONSTRAINT site_fetch_artifacts_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.site_crawl_tasks(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.site_fetch_artifacts
    ADD CONSTRAINT site_fetch_artifacts_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.site_fetch_attempts
    ADD CONSTRAINT site_fetch_attempts_artifact_id_fkey FOREIGN KEY (artifact_id) REFERENCES public.site_fetch_artifacts(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.site_fetch_attempts
    ADD CONSTRAINT site_fetch_attempts_crawl_id_fkey FOREIGN KEY (crawl_id) REFERENCES public.site_crawls(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.site_fetch_attempts
    ADD CONSTRAINT site_fetch_attempts_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.site_crawl_tasks(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.site_fetch_attempts
    ADD CONSTRAINT site_fetch_attempts_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.site_health_profiles
    ADD CONSTRAINT site_health_profiles_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.site_health_profiles
    ADD CONSTRAINT site_health_profiles_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.site_health_snapshots
    ADD CONSTRAINT site_health_snapshots_crawl_id_fkey FOREIGN KEY (crawl_id) REFERENCES public.site_crawls(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.site_health_snapshots
    ADD CONSTRAINT site_health_snapshots_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.site_health_snapshots
    ADD CONSTRAINT site_health_snapshots_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.site_internal_link_events
    ADD CONSTRAINT site_internal_link_events_workspace_id_project_id_run_id_fkey FOREIGN KEY (workspace_id, project_id, run_id) REFERENCES public.site_internal_link_runs(workspace_id, project_id, id) ON DELETE CASCADE;

ALTER TABLE ONLY public.site_internal_link_runs
    ADD CONSTRAINT site_internal_link_runs_workspace_id_project_id_crawl_id_fkey FOREIGN KEY (workspace_id, project_id, crawl_id) REFERENCES public.site_crawls(workspace_id, project_id, id) ON DELETE CASCADE;

ALTER TABLE ONLY public.site_issues
    ADD CONSTRAINT site_issues_analysis_id_fkey FOREIGN KEY (analysis_id) REFERENCES public.site_page_analyses(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.site_issues
    ADD CONSTRAINT site_issues_crawl_id_fkey FOREIGN KEY (crawl_id) REFERENCES public.site_crawls(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.site_issues
    ADD CONSTRAINT site_issues_evaluation_id_fkey FOREIGN KEY (evaluation_id) REFERENCES public.site_rule_evaluations(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.site_issues
    ADD CONSTRAINT site_issues_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.site_issues
    ADD CONSTRAINT site_issues_site_url_id_fkey FOREIGN KEY (site_url_id) REFERENCES public.site_urls(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.site_issues
    ADD CONSTRAINT site_issues_source_artifact_id_fkey FOREIGN KEY (source_artifact_id) REFERENCES public.site_fetch_artifacts(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.site_issues
    ADD CONSTRAINT site_issues_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.site_observed_architectures
    ADD CONSTRAINT site_observed_architectures_source_snapshot_id_fkey FOREIGN KEY (source_snapshot_id) REFERENCES public.site_health_snapshots(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.site_observed_architectures
    ADD CONSTRAINT site_observed_architectures_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.site_page_analyses
    ADD CONSTRAINT site_page_analyses_artifact_id_fkey FOREIGN KEY (artifact_id) REFERENCES public.site_fetch_artifacts(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.site_page_analyses
    ADD CONSTRAINT site_page_analyses_crawl_id_fkey FOREIGN KEY (crawl_id) REFERENCES public.site_crawls(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.site_page_analyses
    ADD CONSTRAINT site_page_analyses_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.site_page_analyses
    ADD CONSTRAINT site_page_analyses_site_url_id_fkey FOREIGN KEY (site_url_id) REFERENCES public.site_urls(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.site_page_analyses
    ADD CONSTRAINT site_page_analyses_supersedes_analysis_id_fkey FOREIGN KEY (supersedes_analysis_id) REFERENCES public.site_page_analyses(id);

ALTER TABLE ONLY public.site_page_analyses
    ADD CONSTRAINT site_page_analyses_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.site_page_link_metrics
    ADD CONSTRAINT site_page_link_metrics_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.site_rule_evaluations
    ADD CONSTRAINT site_rule_evaluations_analysis_id_fkey FOREIGN KEY (analysis_id) REFERENCES public.site_page_analyses(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.site_rule_evaluations
    ADD CONSTRAINT site_rule_evaluations_source_architecture_id_fkey FOREIGN KEY (source_architecture_id) REFERENCES public.site_observed_architectures(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.site_rule_evaluations
    ADD CONSTRAINT site_rule_evaluations_source_artifact_id_fkey FOREIGN KEY (source_artifact_id) REFERENCES public.site_fetch_artifacts(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.site_rule_evaluations
    ADD CONSTRAINT site_rule_evaluations_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.site_url_observations
    ADD CONSTRAINT site_url_observations_parent_site_url_id_fkey FOREIGN KEY (parent_site_url_id) REFERENCES public.site_urls(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.site_url_observations
    ADD CONSTRAINT site_url_observations_source_artifact_id_fkey FOREIGN KEY (source_artifact_id) REFERENCES public.site_fetch_artifacts(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.site_url_observations
    ADD CONSTRAINT site_url_observations_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.site_urls
    ADD CONSTRAINT site_urls_first_seen_crawl_id_fkey FOREIGN KEY (first_seen_crawl_id) REFERENCES public.site_crawls(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.site_urls
    ADD CONSTRAINT site_urls_last_seen_crawl_id_fkey FOREIGN KEY (last_seen_crawl_id) REFERENCES public.site_crawls(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.site_urls
    ADD CONSTRAINT site_urls_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.site_urls
    ADD CONSTRAINT site_urls_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.source_page_entity_presences
    ADD CONSTRAINT source_page_entity_presences_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.source_page_entity_presences
    ADD CONSTRAINT source_page_entity_presences_snapshot_id_fkey FOREIGN KEY (snapshot_id) REFERENCES public.source_page_snapshots(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.source_page_entity_presences
    ADD CONSTRAINT source_page_entity_presences_source_page_id_fkey FOREIGN KEY (source_page_id) REFERENCES public.source_pages(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.source_page_entity_presences
    ADD CONSTRAINT source_page_entity_presences_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.source_page_inspection_spend
    ADD CONSTRAINT source_page_inspection_spend_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.source_page_inspection_spend
    ADD CONSTRAINT source_page_inspection_spend_source_page_id_fkey FOREIGN KEY (source_page_id) REFERENCES public.source_pages(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.source_page_inspection_spend
    ADD CONSTRAINT source_page_inspection_spend_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.source_page_snapshots
    ADD CONSTRAINT source_page_snapshots_audit_id_fkey FOREIGN KEY (audit_id) REFERENCES public.audits(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.source_page_snapshots
    ADD CONSTRAINT source_page_snapshots_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.source_page_snapshots
    ADD CONSTRAINT source_page_snapshots_source_page_id_fkey FOREIGN KEY (source_page_id) REFERENCES public.source_pages(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.source_page_snapshots
    ADD CONSTRAINT source_page_snapshots_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.source_pages
    ADD CONSTRAINT source_pages_first_seen_audit_id_fkey FOREIGN KEY (first_seen_audit_id) REFERENCES public.audits(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.source_pages
    ADD CONSTRAINT source_pages_last_seen_audit_id_fkey FOREIGN KEY (last_seen_audit_id) REFERENCES public.audits(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.source_pages
    ADD CONSTRAINT source_pages_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.source_pages
    ADD CONSTRAINT source_pages_workspace_id_project_id_fkey FOREIGN KEY (workspace_id, project_id) REFERENCES public.projects(workspace_id, id) ON DELETE CASCADE;

ALTER TABLE ONLY public.topics
    ADD CONSTRAINT topics_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES public.topics(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.topics
    ADD CONSTRAINT topics_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.traffic_page_stats
    ADD CONSTRAINT traffic_page_stats_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.traffic_page_stats
    ADD CONSTRAINT traffic_page_stats_site_url_id_fkey FOREIGN KEY (site_url_id) REFERENCES public.site_urls(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.traffic_page_stats
    ADD CONSTRAINT traffic_page_stats_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.traffic_query_stats
    ADD CONSTRAINT traffic_query_stats_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.traffic_query_stats
    ADD CONSTRAINT traffic_query_stats_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.traffic_snapshots
    ADD CONSTRAINT traffic_snapshots_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.traffic_snapshots
    ADD CONSTRAINT traffic_snapshots_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.unintended_domains
    ADD CONSTRAINT unintended_domains_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.user_identities
    ADD CONSTRAINT user_identities_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.workspace_invitations
    ADD CONSTRAINT workspace_invitations_accepted_by_user_id_fkey FOREIGN KEY (accepted_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.workspace_invitations
    ADD CONSTRAINT workspace_invitations_invited_by_user_id_fkey FOREIGN KEY (invited_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.workspace_invitations
    ADD CONSTRAINT workspace_invitations_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.workspace_members
    ADD CONSTRAINT workspace_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.workspace_members
    ADD CONSTRAINT workspace_members_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.workspace_site_health_runtime
    ADD CONSTRAINT workspace_site_health_runtime_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;
