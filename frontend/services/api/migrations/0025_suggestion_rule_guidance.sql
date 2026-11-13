-- The content rule catalog's guidance on each page suggestion (content rules
-- engine, "The rule catalog"). Forward-only and safe on existing rows: one
-- nullable column.
--
-- A suggestion applies one catalog rule; its source and strength can change
-- with the catalog, so they are resolved once, when the suggestion is stored,
-- and read back as stored: `{catalog_version, strength, source_key,
-- source_label, source_url}`. `strength` is `requirement`, `recommendation` or
-- `heuristic`. Suggestions stored before the catalog have none.
ALTER TABLE public.agent_output_suggestions
    ADD COLUMN rule_guidance jsonb;

ALTER TABLE public.agent_output_suggestions
    ADD CONSTRAINT ck_agent_output_suggestions_rule_guidance CHECK (
        rule_guidance IS NULL
        OR (
            jsonb_typeof(rule_guidance) = 'object'
            AND rule_guidance->>'strength' IN ('requirement', 'recommendation', 'heuristic')
            AND jsonb_typeof(rule_guidance->'source_url') = 'string'
            AND jsonb_typeof(rule_guidance->'catalog_version') = 'string'
        )
    );
