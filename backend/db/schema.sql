-- Snapshot of the data pipeline schema (schema_migration up to 0003_supply_and_financials), schema only.
-- The pipeline owns this schema; this service only reads it. Used to build the test database.
-- Refresh: pg_dump --schema-only --no-owner --no-privileges --no-comments, then drop the \restrict lines.
--
-- PostgreSQL database dump
--


-- Dumped from database version 18.6 (Debian 18.6-1.pgdg13+2)
-- Dumped by pg_dump version 18.6 (Debian 18.6-1.pgdg13+2)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: classification_evidence; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.classification_evidence (
    run_id integer NOT NULL,
    vacancy_id bigint NOT NULL,
    signal text NOT NULL,
    origin text NOT NULL,
    weight real,
    snippet text
);


--
-- Name: classifier_run; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.classifier_run (
    run_id integer NOT NULL,
    classifier text NOT NULL,
    version text,
    rules_sha256 text,
    params jsonb,
    started_at timestamp with time zone NOT NULL,
    note text
);


--
-- Name: classifier_run_run_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.classifier_run_run_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: classifier_run_run_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.classifier_run_run_id_seq OWNED BY public.classifier_run.run_id;


--
-- Name: company; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.company (
    company_id bigint NOT NULL,
    gur_id integer,
    inn text,
    ogrn text,
    inn_raw text,
    ogrn_raw text,
    swift text,
    bik text,
    bank_license text,
    name_full_uk text NOT NULL,
    name_full_ru text,
    name_full_en text,
    name_short_uk text,
    name_short_ru text,
    name_short_en text,
    country_id integer,
    address_uk text,
    address_ru text,
    address_en text,
    postal_code text,
    region text,
    city text,
    description_uk text,
    description_ru text,
    description_en text,
    products_uk text[],
    products_ru text[],
    products_en text[],
    license_vvt text,
    status_raw text,
    liquidated_on date,
    website text,
    website_domain text,
    logo_url text,
    sanctions_count smallint DEFAULT 0 NOT NULL,
    sanctions_count_intl smallint DEFAULT 0 NOT NULL,
    rostec_tree_level smallint,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    kpp text
);


--
-- Name: company_company_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.company_company_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: company_company_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.company_company_id_seq OWNED BY public.company.company_id;


--
-- Name: company_edge; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.company_edge (
    company_id bigint NOT NULL,
    related_id bigint NOT NULL,
    kind text NOT NULL,
    source text DEFAULT 'profile'::text NOT NULL,
    label text,
    evidence_url text,
    CONSTRAINT company_edge_check CHECK ((company_id <> related_id)),
    CONSTRAINT company_edge_kind_check CHECK ((kind = ANY (ARRAY['parent'::text, 'bank'::text, 'related'::text, 'successor'::text, 'supplier'::text])))
);


--
-- Name: company_financial; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.company_financial (
    company_id bigint NOT NULL,
    year smallint NOT NULL,
    metric text NOT NULL,
    scope text NOT NULL,
    amount numeric(20,2) NOT NULL,
    currency character(3) DEFAULT 'RUB'::bpchar NOT NULL,
    amount_as_published text,
    accounting_standard text,
    evidence_type text NOT NULL,
    source_url text NOT NULL,
    source text NOT NULL,
    CONSTRAINT company_financial_evidence_type_check CHECK ((evidence_type = ANY (ARRAY['corporate_statement'::text, 'secondary_reporting'::text]))),
    CONSTRAINT company_financial_metric_check CHECK ((metric = ANY (ARRAY['revenue'::text, 'consolidated_revenue'::text, 'net_profit'::text, 'investment'::text]))),
    CONSTRAINT company_financial_scope_check CHECK ((scope = ANY (ARRAY['legal_entity'::text, 'consolidated_group'::text])))
);


--
-- Name: company_link; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.company_link (
    company_id bigint NOT NULL,
    kind text NOT NULL,
    "position" smallint NOT NULL,
    url text NOT NULL,
    CONSTRAINT company_link_kind_check CHECK ((kind = ANY (ARRAY['source'::text, 'archive'::text])))
);


--
-- Name: company_sanction; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.company_sanction (
    company_id bigint NOT NULL,
    jurisdiction text NOT NULL,
    is_sanctioned boolean NOT NULL,
    listed_on date,
    doc_url text
);


--
-- Name: company_section; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.company_section (
    company_id bigint NOT NULL,
    section text NOT NULL,
    url_uk text NOT NULL,
    url_ru text,
    url_en text,
    CONSTRAINT company_section_section_check CHECK ((section = ANY (ARRAY['rostec'::text, 'uav/companies'::text, 'tools/company'::text, 'sanctions/companies'::text])))
);


--
-- Name: company_uav_model; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.company_uav_model (
    company_id bigint NOT NULL,
    uav_model_id integer NOT NULL
);


--
-- Name: company_weapon; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.company_weapon (
    company_id bigint NOT NULL,
    weapon_slug text NOT NULL
);


--
-- Name: company_weapon_component; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.company_weapon_component (
    company_id bigint NOT NULL,
    weapon_slug text NOT NULL,
    part_id integer NOT NULL
);


--
-- Name: component; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.component (
    part_id integer NOT NULL,
    url text NOT NULL,
    name_uk text,
    name_ru text,
    name_en text
);


--
-- Name: country; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.country (
    country_id integer NOT NULL,
    gur_country_id integer,
    name_uk text NOT NULL,
    name_ru text,
    name_en text,
    iso2 character(2)
);


--
-- Name: country_country_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.country_country_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: country_country_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.country_country_id_seq OWNED BY public.country.country_id;


--
-- Name: employer_classification; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.employer_classification (
    run_id integer NOT NULL,
    employer_profile_id bigint NOT NULL,
    level text NOT NULL,
    raw_label text NOT NULL,
    score real,
    category text,
    CONSTRAINT employer_classification_level_check CHECK ((level = ANY (ARRAY['confirmed'::text, 'likely'::text, 'review'::text, 'no'::text, 'out_of_scope'::text])))
);


--
-- Name: employer_company_match; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.employer_company_match (
    employer_profile_id bigint NOT NULL,
    company_id bigint NOT NULL,
    status text NOT NULL,
    method text NOT NULL,
    confidence real,
    model_version text,
    evidence jsonb,
    reviewed_by text,
    reviewed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT employer_company_match_check CHECK (((status <> 'verified'::text) OR ((reviewed_by IS NOT NULL) AND (reviewed_at IS NOT NULL) AND (evidence IS NOT NULL)))),
    CONSTRAINT employer_company_match_status_check CHECK ((status = ANY (ARRAY['auto'::text, 'candidate'::text, 'predicted'::text, 'verified'::text, 'rejected'::text])))
);


--
-- Name: employer_profile; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.employer_profile (
    employer_profile_id bigint NOT NULL,
    source text NOT NULL,
    id_namespace text DEFAULT ''::text NOT NULL,
    external_id text NOT NULL,
    name text NOT NULL,
    url text,
    inn text,
    ogrn text,
    kpp text,
    publisher_type text DEFAULT 'unknown'::text NOT NULL,
    first_seen_at timestamp with time zone NOT NULL,
    last_seen_at timestamp with time zone NOT NULL,
    CONSTRAINT employer_profile_publisher_type_check CHECK ((publisher_type = ANY (ARRAY['employer'::text, 'agency'::text, 'unknown'::text])))
);


--
-- Name: employer_profile_employer_profile_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.employer_profile_employer_profile_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: employer_profile_employer_profile_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.employer_profile_employer_profile_id_seq OWNED BY public.employer_profile.employer_profile_id;


--
-- Name: equipment_manufacturer; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.equipment_manufacturer (
    manufacturer_id integer NOT NULL,
    name text NOT NULL
);


--
-- Name: manual_review; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.manual_review (
    review_id bigint NOT NULL,
    vacancy_id bigint,
    employer_profile_id bigint,
    verdict text NOT NULL,
    comment text,
    reviewed_by text NOT NULL,
    reviewed_at timestamp with time zone NOT NULL,
    CONSTRAINT manual_review_check CHECK (((vacancy_id IS NULL) <> (employer_profile_id IS NULL))),
    CONSTRAINT manual_review_verdict_check CHECK ((verdict = ANY (ARRAY['vpk'::text, 'not_vpk'::text, 'unclear'::text])))
);


--
-- Name: manual_review_review_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.manual_review_review_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: manual_review_review_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.manual_review_review_id_seq OWNED BY public.manual_review.review_id;


--
-- Name: opensanctions_code; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.opensanctions_code (
    kind text NOT NULL,
    code text NOT NULL,
    os_id text NOT NULL,
    CONSTRAINT opensanctions_code_kind_check CHECK ((kind = ANY (ARRAY['inn'::text, 'ogrn'::text])))
);


--
-- Name: opensanctions_entity; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.opensanctions_entity (
    os_id text NOT NULL,
    name text NOT NULL,
    programs text[] NOT NULL,
    defense_hint text,
    dataset_version text NOT NULL
);


--
-- Name: region; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.region (
    region_id integer NOT NULL,
    name text NOT NULL,
    kladr_code text
);


--
-- Name: region_region_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.region_region_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: region_region_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.region_region_id_seq OWNED BY public.region.region_id;


--
-- Name: sanction_jurisdiction; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sanction_jurisdiction (
    code text NOT NULL,
    name_uk text NOT NULL
);


--
-- Name: schema_migration; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.schema_migration (
    version text NOT NULL,
    applied_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: source_record; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.source_record (
    source_record_id bigint NOT NULL,
    source text NOT NULL,
    section text,
    entity_type text NOT NULL,
    entity_key text NOT NULL,
    url text,
    raw_html_path text,
    scraped_at timestamp with time zone NOT NULL,
    CONSTRAINT source_record_entity_type_check CHECK ((entity_type = ANY (ARRAY['company'::text, 'tool'::text, 'uav_model'::text])))
);


--
-- Name: source_record_source_record_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.source_record_source_record_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: source_record_source_record_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.source_record_source_record_id_seq OWNED BY public.source_record.source_record_id;


--
-- Name: tool; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tool (
    tool_id integer NOT NULL,
    plant_company_id bigint NOT NULL,
    manufacturer_id integer,
    url_uk text NOT NULL,
    url_ru text,
    url_en text,
    title_uk text,
    title_ru text,
    title_en text,
    name_uk text,
    name_ru text,
    name_en text,
    cnc_model_uk text,
    cnc_model_ru text,
    cnc_model_en text,
    extra_info_uk text,
    extra_info_ru text,
    extra_info_en text,
    plant_weapons_uk text[],
    plant_weapons_ru text[],
    plant_weapons_en text[],
    quantity integer DEFAULT 1 NOT NULL,
    serial text,
    published_on date,
    photo_url text
);


--
-- Name: tool_country; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tool_country (
    tool_id integer NOT NULL,
    country_id integer NOT NULL
);


--
-- Name: tool_document; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tool_document (
    tool_id integer NOT NULL,
    "position" smallint NOT NULL,
    title text,
    url text NOT NULL
);


--
-- Name: tool_evidence; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tool_evidence (
    tool_id integer NOT NULL,
    "position" smallint NOT NULL,
    evidence_type text,
    published_on date,
    published_raw text,
    author text,
    author_url text,
    timecode text,
    leasing_term text,
    video_urls text[],
    source_urls text[],
    notes text[],
    CONSTRAINT tool_evidence_evidence_type_check CHECK ((evidence_type = ANY (ARRAY['video'::text, 'procurement'::text, 'leasing'::text, 'other'::text])))
);


--
-- Name: tool_photo; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tool_photo (
    tool_id integer NOT NULL,
    "position" smallint NOT NULL,
    url text NOT NULL
);


--
-- Name: uav_model; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.uav_model (
    uav_model_id integer NOT NULL,
    gur_uav_id integer,
    slug text,
    url_uk text NOT NULL,
    url_ru text,
    url_en text,
    name_uk text NOT NULL,
    name_ru text,
    name_en text,
    purpose_uk text,
    purpose_ru text,
    purpose_en text,
    image_url text,
    CONSTRAINT uav_model_check CHECK (((gur_uav_id IS NOT NULL) OR (slug IS NOT NULL)))
);


--
-- Name: uav_model_spec; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.uav_model_spec (
    uav_model_id integer NOT NULL,
    spec_key text NOT NULL,
    "position" smallint NOT NULL,
    label_uk text,
    label_ru text,
    label_en text,
    value_uk text,
    value_ru text,
    value_en text
);


--
-- Name: uav_model_uav_model_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.uav_model_uav_model_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: uav_model_uav_model_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.uav_model_uav_model_id_seq OWNED BY public.uav_model.uav_model_id;


--
-- Name: vacancy; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vacancy (
    vacancy_id bigint NOT NULL,
    source text NOT NULL,
    external_id text NOT NULL,
    url text NOT NULL,
    employer_profile_id bigint,
    employer_name text,
    title text NOT NULL,
    profession text,
    profession_code text,
    specialisation text,
    region_id integer,
    locality text,
    address text,
    lat numeric(9,6),
    lng numeric(9,6),
    salary_from numeric(18,2),
    salary_to numeric(18,2),
    salary_currency text,
    salary_gross boolean,
    salary_period text,
    employment text,
    schedule text,
    experience text,
    experience_years smallint,
    education text,
    description text,
    responsibilities text,
    requirements text,
    conditions text,
    skills_raw text,
    published_at timestamp with time zone,
    modified_at timestamp with time zone,
    first_seen_at timestamp with time zone NOT NULL,
    last_seen_at timestamp with time zone NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    CONSTRAINT vacancy_check CHECK ((last_seen_at >= first_seen_at))
);


--
-- Name: vacancy_classification; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vacancy_classification (
    run_id integer NOT NULL,
    vacancy_id bigint NOT NULL,
    level text NOT NULL,
    raw_label text NOT NULL,
    score real,
    category text,
    CONSTRAINT vacancy_classification_level_check CHECK ((level = ANY (ARRAY['confirmed'::text, 'likely'::text, 'review'::text, 'no'::text, 'out_of_scope'::text])))
);


--
-- Name: vacancy_company_match; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vacancy_company_match (
    vacancy_id bigint NOT NULL,
    company_id bigint NOT NULL,
    status text NOT NULL,
    method text NOT NULL,
    confidence real,
    model_version text,
    evidence jsonb,
    reviewed_by text,
    reviewed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT vacancy_company_match_check CHECK (((status <> 'verified'::text) OR ((reviewed_by IS NOT NULL) AND (reviewed_at IS NOT NULL) AND (evidence IS NOT NULL)))),
    CONSTRAINT vacancy_company_match_status_check CHECK ((status = ANY (ARRAY['candidate'::text, 'predicted'::text, 'verified'::text, 'rejected'::text])))
);


--
-- Name: vacancy_discovery; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vacancy_discovery (
    vacancy_id bigint NOT NULL,
    route text NOT NULL,
    first_seen_at timestamp with time zone,
    last_seen_at timestamp with time zone
);


--
-- Name: vacancy_hh; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vacancy_hh (
    vacancy_id bigint NOT NULL,
    employer_name_detail text,
    employer_resolution_status text,
    address_type text,
    detail_status text,
    source_visibility text
);


--
-- Name: vacancy_snapshot; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vacancy_snapshot (
    vacancy_id bigint NOT NULL,
    fetched_at timestamp with time zone NOT NULL,
    format text NOT NULL,
    path text NOT NULL,
    locator text,
    http_status smallint,
    sha256 text,
    CONSTRAINT vacancy_snapshot_format_check CHECK ((format = ANY (ARRAY['html'::text, 'json'::text])))
);


--
-- Name: vacancy_source; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vacancy_source (
    code text NOT NULL,
    name text NOT NULL,
    base_url text,
    raw_storage text
);


--
-- Name: vacancy_trudvsem; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vacancy_trudvsem (
    vacancy_id bigint NOT NULL,
    origin text,
    work_places integer,
    work_conditions text,
    work_place_type text,
    qualification text,
    hire_date date,
    medical_documents text,
    social_protected text,
    benefits text,
    shift text,
    skills text[]
);


--
-- Name: vacancy_vacancy_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.vacancy_vacancy_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: vacancy_vacancy_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.vacancy_vacancy_id_seq OWNED BY public.vacancy.vacancy_id;


--
-- Name: weapon; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.weapon (
    weapon_slug text NOT NULL,
    url text NOT NULL,
    name_uk text,
    name_ru text,
    name_en text,
    image_url text
);


--
-- Name: classifier_run run_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.classifier_run ALTER COLUMN run_id SET DEFAULT nextval('public.classifier_run_run_id_seq'::regclass);


--
-- Name: company company_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.company ALTER COLUMN company_id SET DEFAULT nextval('public.company_company_id_seq'::regclass);


--
-- Name: country country_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.country ALTER COLUMN country_id SET DEFAULT nextval('public.country_country_id_seq'::regclass);


--
-- Name: employer_profile employer_profile_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employer_profile ALTER COLUMN employer_profile_id SET DEFAULT nextval('public.employer_profile_employer_profile_id_seq'::regclass);


--
-- Name: manual_review review_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.manual_review ALTER COLUMN review_id SET DEFAULT nextval('public.manual_review_review_id_seq'::regclass);


--
-- Name: region region_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.region ALTER COLUMN region_id SET DEFAULT nextval('public.region_region_id_seq'::regclass);


--
-- Name: source_record source_record_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.source_record ALTER COLUMN source_record_id SET DEFAULT nextval('public.source_record_source_record_id_seq'::regclass);


--
-- Name: uav_model uav_model_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.uav_model ALTER COLUMN uav_model_id SET DEFAULT nextval('public.uav_model_uav_model_id_seq'::regclass);


--
-- Name: vacancy vacancy_id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vacancy ALTER COLUMN vacancy_id SET DEFAULT nextval('public.vacancy_vacancy_id_seq'::regclass);


--
-- Name: classifier_run classifier_run_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.classifier_run
    ADD CONSTRAINT classifier_run_pkey PRIMARY KEY (run_id);


--
-- Name: company_edge company_edge_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.company_edge
    ADD CONSTRAINT company_edge_pkey PRIMARY KEY (company_id, related_id, kind, source);


--
-- Name: company_financial company_financial_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.company_financial
    ADD CONSTRAINT company_financial_pkey PRIMARY KEY (company_id, year, metric, scope, source);


--
-- Name: company company_gur_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.company
    ADD CONSTRAINT company_gur_id_key UNIQUE (gur_id);


--
-- Name: company_link company_link_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.company_link
    ADD CONSTRAINT company_link_pkey PRIMARY KEY (company_id, kind, "position");


--
-- Name: company company_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.company
    ADD CONSTRAINT company_pkey PRIMARY KEY (company_id);


--
-- Name: company_sanction company_sanction_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.company_sanction
    ADD CONSTRAINT company_sanction_pkey PRIMARY KEY (company_id, jurisdiction);


--
-- Name: company_section company_section_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.company_section
    ADD CONSTRAINT company_section_pkey PRIMARY KEY (company_id, section);


--
-- Name: company_uav_model company_uav_model_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.company_uav_model
    ADD CONSTRAINT company_uav_model_pkey PRIMARY KEY (company_id, uav_model_id);


--
-- Name: company_weapon_component company_weapon_component_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.company_weapon_component
    ADD CONSTRAINT company_weapon_component_pkey PRIMARY KEY (company_id, weapon_slug, part_id);


--
-- Name: company_weapon company_weapon_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.company_weapon
    ADD CONSTRAINT company_weapon_pkey PRIMARY KEY (company_id, weapon_slug);


--
-- Name: component component_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.component
    ADD CONSTRAINT component_pkey PRIMARY KEY (part_id);


--
-- Name: country country_gur_country_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.country
    ADD CONSTRAINT country_gur_country_id_key UNIQUE (gur_country_id);


--
-- Name: country country_name_uk_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.country
    ADD CONSTRAINT country_name_uk_key UNIQUE (name_uk);


--
-- Name: country country_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.country
    ADD CONSTRAINT country_pkey PRIMARY KEY (country_id);


--
-- Name: employer_classification employer_classification_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employer_classification
    ADD CONSTRAINT employer_classification_pkey PRIMARY KEY (run_id, employer_profile_id);


--
-- Name: employer_company_match employer_company_match_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employer_company_match
    ADD CONSTRAINT employer_company_match_pkey PRIMARY KEY (employer_profile_id, company_id);


--
-- Name: employer_profile employer_profile_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employer_profile
    ADD CONSTRAINT employer_profile_pkey PRIMARY KEY (employer_profile_id);


--
-- Name: employer_profile employer_profile_source_id_namespace_external_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employer_profile
    ADD CONSTRAINT employer_profile_source_id_namespace_external_id_key UNIQUE (source, id_namespace, external_id);


--
-- Name: equipment_manufacturer equipment_manufacturer_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.equipment_manufacturer
    ADD CONSTRAINT equipment_manufacturer_pkey PRIMARY KEY (manufacturer_id);


--
-- Name: manual_review manual_review_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.manual_review
    ADD CONSTRAINT manual_review_pkey PRIMARY KEY (review_id);


--
-- Name: opensanctions_code opensanctions_code_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.opensanctions_code
    ADD CONSTRAINT opensanctions_code_pkey PRIMARY KEY (kind, code, os_id);


--
-- Name: opensanctions_entity opensanctions_entity_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.opensanctions_entity
    ADD CONSTRAINT opensanctions_entity_pkey PRIMARY KEY (os_id);


--
-- Name: region region_kladr_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.region
    ADD CONSTRAINT region_kladr_code_key UNIQUE (kladr_code);


--
-- Name: region region_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.region
    ADD CONSTRAINT region_name_key UNIQUE (name);


--
-- Name: region region_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.region
    ADD CONSTRAINT region_pkey PRIMARY KEY (region_id);


--
-- Name: sanction_jurisdiction sanction_jurisdiction_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sanction_jurisdiction
    ADD CONSTRAINT sanction_jurisdiction_pkey PRIMARY KEY (code);


--
-- Name: schema_migration schema_migration_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schema_migration
    ADD CONSTRAINT schema_migration_pkey PRIMARY KEY (version);


--
-- Name: source_record source_record_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.source_record
    ADD CONSTRAINT source_record_pkey PRIMARY KEY (source_record_id);


--
-- Name: tool_country tool_country_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tool_country
    ADD CONSTRAINT tool_country_pkey PRIMARY KEY (tool_id, country_id);


--
-- Name: tool_document tool_document_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tool_document
    ADD CONSTRAINT tool_document_pkey PRIMARY KEY (tool_id, "position");


--
-- Name: tool_evidence tool_evidence_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tool_evidence
    ADD CONSTRAINT tool_evidence_pkey PRIMARY KEY (tool_id, "position");


--
-- Name: tool_photo tool_photo_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tool_photo
    ADD CONSTRAINT tool_photo_pkey PRIMARY KEY (tool_id, "position");


--
-- Name: tool tool_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tool
    ADD CONSTRAINT tool_pkey PRIMARY KEY (tool_id);


--
-- Name: uav_model uav_model_gur_uav_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.uav_model
    ADD CONSTRAINT uav_model_gur_uav_id_key UNIQUE (gur_uav_id);


--
-- Name: uav_model uav_model_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.uav_model
    ADD CONSTRAINT uav_model_pkey PRIMARY KEY (uav_model_id);


--
-- Name: uav_model uav_model_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.uav_model
    ADD CONSTRAINT uav_model_slug_key UNIQUE (slug);


--
-- Name: uav_model_spec uav_model_spec_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.uav_model_spec
    ADD CONSTRAINT uav_model_spec_pkey PRIMARY KEY (uav_model_id, spec_key);


--
-- Name: vacancy_classification vacancy_classification_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vacancy_classification
    ADD CONSTRAINT vacancy_classification_pkey PRIMARY KEY (run_id, vacancy_id);


--
-- Name: vacancy_company_match vacancy_company_match_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vacancy_company_match
    ADD CONSTRAINT vacancy_company_match_pkey PRIMARY KEY (vacancy_id, company_id, method);


--
-- Name: vacancy_discovery vacancy_discovery_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vacancy_discovery
    ADD CONSTRAINT vacancy_discovery_pkey PRIMARY KEY (vacancy_id, route);


--
-- Name: vacancy_hh vacancy_hh_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vacancy_hh
    ADD CONSTRAINT vacancy_hh_pkey PRIMARY KEY (vacancy_id);


--
-- Name: vacancy vacancy_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vacancy
    ADD CONSTRAINT vacancy_pkey PRIMARY KEY (vacancy_id);


--
-- Name: vacancy_snapshot vacancy_snapshot_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vacancy_snapshot
    ADD CONSTRAINT vacancy_snapshot_pkey PRIMARY KEY (vacancy_id, fetched_at);


--
-- Name: vacancy vacancy_source_external_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vacancy
    ADD CONSTRAINT vacancy_source_external_id_key UNIQUE (source, external_id);


--
-- Name: vacancy_source vacancy_source_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vacancy_source
    ADD CONSTRAINT vacancy_source_pkey PRIMARY KEY (code);


--
-- Name: vacancy_trudvsem vacancy_trudvsem_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vacancy_trudvsem
    ADD CONSTRAINT vacancy_trudvsem_pkey PRIMARY KEY (vacancy_id);


--
-- Name: weapon weapon_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.weapon
    ADD CONSTRAINT weapon_pkey PRIMARY KEY (weapon_slug);


--
-- Name: classification_evidence_vacancy_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX classification_evidence_vacancy_idx ON public.classification_evidence USING btree (run_id, vacancy_id);


--
-- Name: company_country_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX company_country_idx ON public.company USING btree (country_id);


--
-- Name: company_edge_related_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX company_edge_related_idx ON public.company_edge USING btree (related_id, kind);


--
-- Name: company_inn_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX company_inn_idx ON public.company USING btree (inn);


--
-- Name: company_ogrn_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX company_ogrn_idx ON public.company USING btree (ogrn);


--
-- Name: company_sanction_listed_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX company_sanction_listed_idx ON public.company_sanction USING btree (jurisdiction, listed_on) WHERE is_sanctioned;


--
-- Name: employer_company_match_company_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX employer_company_match_company_idx ON public.employer_company_match USING btree (company_id);


--
-- Name: employer_profile_inn_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX employer_profile_inn_idx ON public.employer_profile USING btree (inn, kpp);


--
-- Name: opensanctions_code_code_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX opensanctions_code_code_idx ON public.opensanctions_code USING btree (code);


--
-- Name: source_record_entity_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX source_record_entity_idx ON public.source_record USING btree (entity_type, entity_key);


--
-- Name: tool_manufacturer_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX tool_manufacturer_idx ON public.tool USING btree (manufacturer_id);


--
-- Name: tool_plant_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX tool_plant_idx ON public.tool USING btree (plant_company_id);


--
-- Name: vacancy_active_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX vacancy_active_idx ON public.vacancy USING btree (source, is_active);


--
-- Name: vacancy_classification_level_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX vacancy_classification_level_idx ON public.vacancy_classification USING btree (run_id, level);


--
-- Name: vacancy_company_match_company_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX vacancy_company_match_company_idx ON public.vacancy_company_match USING btree (company_id);


--
-- Name: vacancy_employer_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX vacancy_employer_idx ON public.vacancy USING btree (employer_profile_id);


--
-- Name: vacancy_modified_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX vacancy_modified_idx ON public.vacancy USING btree (modified_at);


--
-- Name: vacancy_region_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX vacancy_region_idx ON public.vacancy USING btree (region_id);


--
-- Name: classification_evidence classification_evidence_run_id_vacancy_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.classification_evidence
    ADD CONSTRAINT classification_evidence_run_id_vacancy_id_fkey FOREIGN KEY (run_id, vacancy_id) REFERENCES public.vacancy_classification(run_id, vacancy_id) ON DELETE CASCADE;


--
-- Name: company company_country_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.company
    ADD CONSTRAINT company_country_id_fkey FOREIGN KEY (country_id) REFERENCES public.country(country_id);


--
-- Name: company_edge company_edge_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.company_edge
    ADD CONSTRAINT company_edge_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.company(company_id) ON DELETE CASCADE;


--
-- Name: company_edge company_edge_related_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.company_edge
    ADD CONSTRAINT company_edge_related_id_fkey FOREIGN KEY (related_id) REFERENCES public.company(company_id) ON DELETE CASCADE;


--
-- Name: company_financial company_financial_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.company_financial
    ADD CONSTRAINT company_financial_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.company(company_id) ON DELETE CASCADE;


--
-- Name: company_link company_link_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.company_link
    ADD CONSTRAINT company_link_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.company(company_id) ON DELETE CASCADE;


--
-- Name: company_sanction company_sanction_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.company_sanction
    ADD CONSTRAINT company_sanction_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.company(company_id) ON DELETE CASCADE;


--
-- Name: company_sanction company_sanction_jurisdiction_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.company_sanction
    ADD CONSTRAINT company_sanction_jurisdiction_fkey FOREIGN KEY (jurisdiction) REFERENCES public.sanction_jurisdiction(code);


--
-- Name: company_section company_section_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.company_section
    ADD CONSTRAINT company_section_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.company(company_id) ON DELETE CASCADE;


--
-- Name: company_uav_model company_uav_model_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.company_uav_model
    ADD CONSTRAINT company_uav_model_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.company(company_id) ON DELETE CASCADE;


--
-- Name: company_uav_model company_uav_model_uav_model_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.company_uav_model
    ADD CONSTRAINT company_uav_model_uav_model_id_fkey FOREIGN KEY (uav_model_id) REFERENCES public.uav_model(uav_model_id) ON DELETE CASCADE;


--
-- Name: company_weapon company_weapon_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.company_weapon
    ADD CONSTRAINT company_weapon_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.company(company_id) ON DELETE CASCADE;


--
-- Name: company_weapon_component company_weapon_component_company_id_weapon_slug_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.company_weapon_component
    ADD CONSTRAINT company_weapon_component_company_id_weapon_slug_fkey FOREIGN KEY (company_id, weapon_slug) REFERENCES public.company_weapon(company_id, weapon_slug) ON DELETE CASCADE;


--
-- Name: company_weapon_component company_weapon_component_part_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.company_weapon_component
    ADD CONSTRAINT company_weapon_component_part_id_fkey FOREIGN KEY (part_id) REFERENCES public.component(part_id);


--
-- Name: company_weapon company_weapon_weapon_slug_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.company_weapon
    ADD CONSTRAINT company_weapon_weapon_slug_fkey FOREIGN KEY (weapon_slug) REFERENCES public.weapon(weapon_slug);


--
-- Name: employer_classification employer_classification_employer_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employer_classification
    ADD CONSTRAINT employer_classification_employer_profile_id_fkey FOREIGN KEY (employer_profile_id) REFERENCES public.employer_profile(employer_profile_id) ON DELETE CASCADE;


--
-- Name: employer_classification employer_classification_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employer_classification
    ADD CONSTRAINT employer_classification_run_id_fkey FOREIGN KEY (run_id) REFERENCES public.classifier_run(run_id) ON DELETE CASCADE;


--
-- Name: employer_company_match employer_company_match_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employer_company_match
    ADD CONSTRAINT employer_company_match_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.company(company_id) ON DELETE CASCADE;


--
-- Name: employer_company_match employer_company_match_employer_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employer_company_match
    ADD CONSTRAINT employer_company_match_employer_profile_id_fkey FOREIGN KEY (employer_profile_id) REFERENCES public.employer_profile(employer_profile_id) ON DELETE CASCADE;


--
-- Name: employer_profile employer_profile_source_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employer_profile
    ADD CONSTRAINT employer_profile_source_fkey FOREIGN KEY (source) REFERENCES public.vacancy_source(code);


--
-- Name: manual_review manual_review_employer_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.manual_review
    ADD CONSTRAINT manual_review_employer_profile_id_fkey FOREIGN KEY (employer_profile_id) REFERENCES public.employer_profile(employer_profile_id) ON DELETE CASCADE;


--
-- Name: manual_review manual_review_vacancy_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.manual_review
    ADD CONSTRAINT manual_review_vacancy_id_fkey FOREIGN KEY (vacancy_id) REFERENCES public.vacancy(vacancy_id) ON DELETE CASCADE;


--
-- Name: opensanctions_code opensanctions_code_os_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.opensanctions_code
    ADD CONSTRAINT opensanctions_code_os_id_fkey FOREIGN KEY (os_id) REFERENCES public.opensanctions_entity(os_id) ON DELETE CASCADE;


--
-- Name: tool_country tool_country_country_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tool_country
    ADD CONSTRAINT tool_country_country_id_fkey FOREIGN KEY (country_id) REFERENCES public.country(country_id);


--
-- Name: tool_country tool_country_tool_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tool_country
    ADD CONSTRAINT tool_country_tool_id_fkey FOREIGN KEY (tool_id) REFERENCES public.tool(tool_id) ON DELETE CASCADE;


--
-- Name: tool_document tool_document_tool_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tool_document
    ADD CONSTRAINT tool_document_tool_id_fkey FOREIGN KEY (tool_id) REFERENCES public.tool(tool_id) ON DELETE CASCADE;


--
-- Name: tool_evidence tool_evidence_tool_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tool_evidence
    ADD CONSTRAINT tool_evidence_tool_id_fkey FOREIGN KEY (tool_id) REFERENCES public.tool(tool_id) ON DELETE CASCADE;


--
-- Name: tool tool_manufacturer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tool
    ADD CONSTRAINT tool_manufacturer_id_fkey FOREIGN KEY (manufacturer_id) REFERENCES public.equipment_manufacturer(manufacturer_id);


--
-- Name: tool_photo tool_photo_tool_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tool_photo
    ADD CONSTRAINT tool_photo_tool_id_fkey FOREIGN KEY (tool_id) REFERENCES public.tool(tool_id) ON DELETE CASCADE;


--
-- Name: tool tool_plant_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tool
    ADD CONSTRAINT tool_plant_company_id_fkey FOREIGN KEY (plant_company_id) REFERENCES public.company(company_id);


--
-- Name: uav_model_spec uav_model_spec_uav_model_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.uav_model_spec
    ADD CONSTRAINT uav_model_spec_uav_model_id_fkey FOREIGN KEY (uav_model_id) REFERENCES public.uav_model(uav_model_id) ON DELETE CASCADE;


--
-- Name: vacancy_classification vacancy_classification_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vacancy_classification
    ADD CONSTRAINT vacancy_classification_run_id_fkey FOREIGN KEY (run_id) REFERENCES public.classifier_run(run_id) ON DELETE CASCADE;


--
-- Name: vacancy_classification vacancy_classification_vacancy_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vacancy_classification
    ADD CONSTRAINT vacancy_classification_vacancy_id_fkey FOREIGN KEY (vacancy_id) REFERENCES public.vacancy(vacancy_id) ON DELETE CASCADE;


--
-- Name: vacancy_company_match vacancy_company_match_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vacancy_company_match
    ADD CONSTRAINT vacancy_company_match_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.company(company_id) ON DELETE CASCADE;


--
-- Name: vacancy_company_match vacancy_company_match_vacancy_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vacancy_company_match
    ADD CONSTRAINT vacancy_company_match_vacancy_id_fkey FOREIGN KEY (vacancy_id) REFERENCES public.vacancy(vacancy_id) ON DELETE CASCADE;


--
-- Name: vacancy_discovery vacancy_discovery_vacancy_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vacancy_discovery
    ADD CONSTRAINT vacancy_discovery_vacancy_id_fkey FOREIGN KEY (vacancy_id) REFERENCES public.vacancy(vacancy_id) ON DELETE CASCADE;


--
-- Name: vacancy vacancy_employer_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vacancy
    ADD CONSTRAINT vacancy_employer_profile_id_fkey FOREIGN KEY (employer_profile_id) REFERENCES public.employer_profile(employer_profile_id);


--
-- Name: vacancy_hh vacancy_hh_vacancy_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vacancy_hh
    ADD CONSTRAINT vacancy_hh_vacancy_id_fkey FOREIGN KEY (vacancy_id) REFERENCES public.vacancy(vacancy_id) ON DELETE CASCADE;


--
-- Name: vacancy vacancy_region_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vacancy
    ADD CONSTRAINT vacancy_region_id_fkey FOREIGN KEY (region_id) REFERENCES public.region(region_id);


--
-- Name: vacancy_snapshot vacancy_snapshot_vacancy_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vacancy_snapshot
    ADD CONSTRAINT vacancy_snapshot_vacancy_id_fkey FOREIGN KEY (vacancy_id) REFERENCES public.vacancy(vacancy_id) ON DELETE CASCADE;


--
-- Name: vacancy vacancy_source_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vacancy
    ADD CONSTRAINT vacancy_source_fkey FOREIGN KEY (source) REFERENCES public.vacancy_source(code);


--
-- Name: vacancy_trudvsem vacancy_trudvsem_vacancy_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vacancy_trudvsem
    ADD CONSTRAINT vacancy_trudvsem_vacancy_id_fkey FOREIGN KEY (vacancy_id) REFERENCES public.vacancy(vacancy_id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--
