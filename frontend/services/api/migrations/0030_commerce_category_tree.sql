-- Catalog ingestion (commerce improvement PR 6, owner decision CM3).
-- Forward-only and safe on existing rows.
--
-- Categories form a tree: `parent_category_id` names the category one level
-- up, written from crawled breadcrumbs and from imported `A > B` paths. The
-- parent is always a category of the same project (composite reference), and
-- deleting it leaves the child at the top level.
--
-- Products keep the image an import supplied and, for products with priced
-- variants, the highest variant price beside `price` (the lowest), so the
-- catalog price reads as a range.
--
-- One import record covers the three sources (CSV template, Merchant Center
-- feed, Shopify storefront): `source_format` says which, `source_ref` holds
-- the Shopify store host. An import is staged first and applied only when
-- the person confirms its category tree (`applied_at`), with the proposed
-- categories they left out in `excluded_categories`. Imports recorded before
-- staging existed were applied when they were created.

ALTER TABLE public.commerce_categories
    ADD COLUMN parent_category_id uuid,
    ADD CONSTRAINT uq_commerce_categories_scope_id UNIQUE (workspace_id, project_id, id),
    ADD CONSTRAINT ck_commerce_categories_parent CHECK (parent_category_id IS NULL OR parent_category_id <> id);

ALTER TABLE public.commerce_categories
    ADD CONSTRAINT commerce_categories_parent_fkey
        FOREIGN KEY (workspace_id, project_id, parent_category_id)
        REFERENCES public.commerce_categories(workspace_id, project_id, id)
        ON DELETE SET NULL (parent_category_id);

CREATE INDEX ix_commerce_categories_parent
    ON public.commerce_categories USING btree (parent_category_id)
    WHERE parent_category_id IS NOT NULL;

ALTER TABLE public.commerce_products
    ADD COLUMN image_url text NOT NULL DEFAULT '',
    ADD COLUMN price_max numeric(14,2),
    ADD CONSTRAINT ck_commerce_products_price_range CHECK (
        price_max IS NULL OR (price IS NOT NULL AND price_max >= price)
    );
ALTER TABLE public.commerce_products ALTER COLUMN image_url DROP DEFAULT;

ALTER TABLE public.commerce_csv_imports
    ADD COLUMN source_format character varying(24) NOT NULL DEFAULT 'csv',
    ADD COLUMN source_ref character varying(255) NOT NULL DEFAULT '',
    ADD COLUMN excluded_categories jsonb NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN applied_at timestamp with time zone,
    ADD CONSTRAINT ck_commerce_csv_imports_format CHECK (
        source_format IN ('csv', 'merchant_center', 'shopify')
    );

UPDATE public.commerce_csv_imports SET applied_at = created_at WHERE applied_at IS NULL;

ALTER TABLE public.commerce_csv_imports
    ALTER COLUMN source_format DROP DEFAULT,
    ALTER COLUMN source_ref DROP DEFAULT,
    ALTER COLUMN excluded_categories DROP DEFAULT;
