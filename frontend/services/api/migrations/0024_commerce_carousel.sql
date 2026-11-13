-- ChatGPT shopping carousel capture. Forward-only
-- and safe on existing rows, which keep NULL: the fields were not observed.
--
-- A carousel card is recorded as a shelf observation with
-- surface_kind = 'shopping_result' and these card fields beside the existing
-- price, currency and merchant URL. Every field is optional on a card; NULL
-- means the card did not carry it (text recommendations never do).
--
-- observed_tag: ChatGPT's label on the card ("Best overall value").
-- observed_merchant_name: the card's merchant name.
-- observed_external_product_id: ChatGPT's own product key; a later card with
--   the same key matches the product or competitor an earlier card matched.
-- observed_image_url: the card's first image URL, kept as evidence only.
ALTER TABLE public.commerce_recommendation_observations
    ADD COLUMN observed_tag character varying(255);
ALTER TABLE public.commerce_recommendation_observations
    ADD COLUMN observed_merchant_name character varying(255);
ALTER TABLE public.commerce_recommendation_observations
    ADD COLUMN observed_external_product_id character varying(255);
ALTER TABLE public.commerce_recommendation_observations
    ADD COLUMN observed_image_url text;

-- The product-key lookup is project-scoped and reads the latest match first.
CREATE INDEX ix_commerce_observation_external_product
    ON public.commerce_recommendation_observations
    (workspace_id, project_id, observed_external_product_id, created_at DESC)
    WHERE observed_external_product_id IS NOT NULL;
