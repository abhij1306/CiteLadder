-- Audit error codes fit their columns (architecture untangle DB3). Forward-only
-- and safe on existing rows: widening a varchar is a catalog change, no rewrite.
--
-- A failed audit task records its error code on the task and on its provider
-- attempt. Both were varchar(32), while the declared surface code
-- `credential_unavailable_for_retrieval` is 36 characters, so persisting that
-- failure errored. They now match `aio_observations.error_code` (varchar(64)),
-- which records the same codes.
ALTER TABLE public.audit_tasks
    ALTER COLUMN error_code TYPE character varying(64);
ALTER TABLE public.provider_attempts
    ALTER COLUMN error_code TYPE character varying(64);
