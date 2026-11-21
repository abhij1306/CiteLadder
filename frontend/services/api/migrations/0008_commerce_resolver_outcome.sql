-- What the optional Commerce shelf resolver did for each recorded recommendation,
-- and the prompt template its model call used (invariants 7 and 9). Forward-only
-- and safe on existing rows, which keep NULL (not recorded).
--
-- resolver_outcome: resolved, omitted (the call answered without this span),
-- not_needed (matched deterministically or no product signal), failed (the call
-- threw or returned malformed output) or unavailable (no resolver configured).
-- resolver_template_version is set whenever the resolver model was called.
ALTER TABLE public.commerce_recommendation_observations
    ADD COLUMN resolver_outcome character varying(16);
ALTER TABLE public.commerce_recommendation_observations
    ADD COLUMN resolver_template_version character varying(64);
ALTER TABLE public.commerce_recommendation_observations
    ADD CONSTRAINT ck_commerce_observation_resolver_outcome CHECK (resolver_outcome IS NULL OR (resolver_outcome)::text = ANY ((ARRAY['resolved'::character varying, 'omitted'::character varying, 'not_needed'::character varying, 'failed'::character varying, 'unavailable'::character varying])::text[]));
