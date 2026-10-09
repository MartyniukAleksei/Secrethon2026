-- Vacancy duties taxonomy, separate from employer VPK screening and human reviews.
CREATE TABLE IF NOT EXISTS public.vacancy_direction_run (
    run_id uuid PRIMARY KEY,
    created_at timestamptz NOT NULL DEFAULT now(),
    published_at timestamptz,
    status text NOT NULL CHECK (status IN ('staging', 'published', 'withdrawn')),
    model_requested text NOT NULL,
    models_returned text[] NOT NULL,
    prompt_version text NOT NULL,
    input_count integer NOT NULL CHECK (input_count > 0),
    source_sha256 text NOT NULL,
    metadata jsonb NOT NULL
);

CREATE TABLE IF NOT EXISTS public.vacancy_direction (
    run_id uuid NOT NULL REFERENCES public.vacancy_direction_run(run_id),
    vacancy_id bigint NOT NULL REFERENCES public.vacancy(vacancy_id) ON DELETE CASCADE,
    domain text NOT NULL,
    role text NOT NULL,
    domain_confidence double precision NOT NULL CHECK (domain_confidence BETWEEN 0 AND 1),
    role_confidence double precision NOT NULL CHECK (role_confidence BETWEEN 0 AND 1),
    review boolean NOT NULL,
    model text NOT NULL,
    input_fingerprint text NOT NULL,
    decisions jsonb NOT NULL,
    PRIMARY KEY (run_id, vacancy_id)
);

-- A complete run becomes visible atomically. Earlier runs remain available for rollback.
CREATE OR REPLACE VIEW public.vacancy_direction_latest AS
SELECT d.* FROM public.vacancy_direction d
WHERE d.run_id = (
    SELECT run_id FROM public.vacancy_direction_run
    WHERE status = 'published' ORDER BY published_at DESC, run_id DESC LIMIT 1
);
