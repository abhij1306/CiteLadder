-- An entity or claim the perception or verification model was sent but left
-- out of its answer (invariant 7). Its row keeps the placeholder label or
-- verdict the check constraints require (`not_assessable`, `not_covered`); reads
-- treat a flagged row as unavailable, never as that judgement. Forward-only;
-- existing rows read false.
ALTER TABLE public.entity_sentiments
    ADD COLUMN model_omitted boolean DEFAULT false NOT NULL;
ALTER TABLE public.claim_verdicts
    ADD COLUMN model_omitted boolean DEFAULT false NOT NULL;
