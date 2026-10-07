-- Small hand-made data set over the pipeline schema (db/schema.sql) for API tests.
-- Two ВПК employers (one matched to a GUR company by INN) and one non-ВПК employer.

INSERT INTO vacancy_source (code, name, base_url) VALUES
  ('hh', 'HeadHunter', 'https://hh.ru'), ('trudvsem', 'Работа России', 'https://trudvsem.ru');

INSERT INTO region (region_id, name) VALUES (64, 'Тульская область'), (70, 'Город Москва');

INSERT INTO classifier_run (run_id, classifier, version, started_at)
VALUES (1, 'hh_filter', 'test', '2026-10-05T00:00:00Z'),
       (2, 'trudvsem_vpk_rules', 'test', '2026-10-05T00:00:00Z');

INSERT INTO employer_profile (employer_profile_id, source, external_id, name, url, inn, first_seen_at, last_seen_at) VALUES
  (1, 'trudvsem', 'e1', 'АО "КБП"', 'https://trudvsem.ru/company/1', '7105514574', '2026-10-05T00:00:00Z', '2026-10-05T00:00:00Z'),
  (2, 'hh', 'e2', 'Алабуга. Менеджмент', NULL, NULL, '2026-10-05T00:00:00Z', '2026-10-05T00:00:00Z'),
  (3, 'hh', 'e3', 'Пекарня', NULL, NULL, '2026-10-05T00:00:00Z', '2026-10-05T00:00:00Z');
UPDATE employer_profile SET ogrn = '1117154036911', kpp = '710501001' WHERE employer_profile_id = 1;

-- region_id is set only on trudvsem rows; the hh vacancy in Тула gets its region from them.
INSERT INTO vacancy (vacancy_id, source, external_id, url, employer_profile_id, employer_name, title, region_id, locality,
                     salary_from, salary_to, salary_currency, salary_period, experience, published_at, first_seen_at, last_seen_at, description) VALUES
  (1, 'trudvsem', 'v1', 'https://trudvsem.ru/vacancy/1', 1, 'АО "КБП"', 'Токарь', 64, 'Тула', 70000, 80000, 'RUB', NULL, NULL, '2026-09-20T00:00:00Z', '2026-10-05T00:00:00Z', '2026-10-05T12:00:00Z', 'Обработка деталей'),
  (2, 'trudvsem', 'v2', 'https://trudvsem.ru/vacancy/2', 1, 'АО "КБП"', 'Инженер', 64, 'Тула', 60000, NULL, 'RUB', NULL, NULL, '2026-06-01T00:00:00Z', '2026-10-05T00:00:00Z', '2026-10-05T12:00:00Z', NULL),
  (3, 'hh', 'v3', 'https://hh.ru/vacancy/3', 1, 'АО "КБП"', 'Токарь', NULL, 'Тула', NULL, NULL, NULL, NULL, '1–3 года', '2026-10-01T00:00:00Z', '2026-10-05T00:00:00Z', '2026-10-05T12:00:00Z', NULL),
  (4, 'hh', 'v4', 'https://hh.ru/vacancy/4', 2, 'Алабуга. Менеджмент', 'Сборщик БпЛА', NULL, 'Москва', 100000, 120000, 'RUB', 'MONTH', 'не требуется', '2026-10-02T00:00:00Z', '2026-10-05T00:00:00Z', '2026-10-05T12:00:00Z', NULL),
  (5, 'trudvsem', 'v5', 'https://trudvsem.ru/vacancy/5', 2, 'Алабуга. Менеджмент', 'Оператор', 70, 'Москва', 90000, NULL, 'RUB', NULL, NULL, '2026-09-01T00:00:00Z', '2026-10-05T00:00:00Z', '2026-10-05T12:00:00Z', NULL),
  (6, 'hh', 'v6', 'https://hh.ru/vacancy/6', 3, 'Пекарня', 'Пекарь', NULL, 'Москва', 50000, NULL, 'RUB', 'MONTH', NULL, '2026-10-03T00:00:00Z', '2026-10-05T00:00:00Z', '2026-10-05T12:00:00Z', NULL);

-- Run 1 labelled vacancy 3 as `review`; the later run 2 re-labels it `likely` and must win.
-- Coordinates are synthetic test locations, not verified enterprise addresses.
UPDATE vacancy SET lat = 54.193, lng = 37.617 WHERE vacancy_id IN (1, 2);
UPDATE vacancy SET lat = 54.200, lng = 37.630 WHERE vacancy_id = 3;
UPDATE vacancy SET lat = 95, lng = 37.617 WHERE vacancy_id = 4; -- invalid latitude
UPDATE vacancy SET lat = 55.750, lng = 37.610 WHERE vacancy_id = 6; -- non-VPK
UPDATE vacancy SET address = 'Тула, ул. Найма, 1' WHERE vacancy_id = 1;
UPDATE vacancy SET address = '  Тула, ул. Найма, 1  ' WHERE vacancy_id = 2;
UPDATE vacancy SET address = '   ' WHERE vacancy_id = 3;
UPDATE vacancy SET locality = NULL WHERE vacancy_id = 5; -- no hiring place
UPDATE vacancy SET address = 'Москва, ул. Пекарни, 6' WHERE vacancy_id = 6;

INSERT INTO vacancy (vacancy_id, source, external_id, url, employer_profile_id, title,
                     address, is_active, published_at, first_seen_at, last_seen_at)
VALUES (7, 'trudvsem', 'v7', 'https://trudvsem.ru/vacancy/7', 1, 'Инженер',
        'Старая площадка', false, '2026-10-03T00:00:00Z', '2026-10-05T00:00:00Z', '2026-10-05T12:00:00Z');

INSERT INTO vacancy_classification (run_id, vacancy_id, level, raw_label, category) VALUES
  (2, 1, 'confirmed', 'точно', 'производство'),
  (2, 2, 'likely', 'вероятно', 'НИИ/КБ'),
  (1, 3, 'review', 'review_weak_signal', NULL),
  (2, 3, 'likely', 'вероятно', 'производство'),
  (1, 4, 'likely', 'likely', NULL),
  (2, 5, 'likely', 'вероятно', 'производство'),
  (1, 6, 'no', 'no', NULL),
  (2, 7, 'confirmed', 'точно', 'производство');

INSERT INTO country (country_id, name_uk) VALUES (1, 'російська федерація');
INSERT INTO sanction_jurisdiction (code, name_uk) VALUES ('US', 'США'), ('UA', 'Україна');

INSERT INTO company (company_id, inn, name_full_uk, name_short_uk, country_id, address_uk, description_uk, sanctions_count, sanctions_count_intl) VALUES
  (570, '7105514574', 'АКЦІОНЕРНЕ ТОВАРИСТВО "КБП"', 'АТ "КБП"', 1, 'м. Тула', 'Розробник озброєння.', 2, 1),
  (522, '7704721192', 'АТ "НПО "ВИСОКОТОЧНІ КОМПЛЕКСИ"', 'АТ "ВК"', 1, NULL, NULL, 1, 1);

INSERT INTO company_section (company_id, section, url_uk) VALUES (570, 'rostec', 'https://war-sanctions.gur.gov.ua/rostec/1921');
INSERT INTO company_sanction (company_id, jurisdiction, is_sanctioned, listed_on) VALUES
  (570, 'US', true, '2022-06-02'), (570, 'UA', true, NULL), (522, 'US', true, NULL);
INSERT INTO company_edge (company_id, related_id, kind) VALUES (570, 522, 'parent');

-- The map keeps sourced relationships even when an endpoint has no vacancy coordinates.
INSERT INTO company (company_id, name_full_uk, country_id, address_uk)
VALUES (523, 'Постачальник без координат', 1, 'м. Москва');
INSERT INTO company_edge (company_id, related_id, kind, source, label, evidence_url)
VALUES (522, 523, 'supplier', 'vpk_atlas', 'Оптичні матеріали', 'https://example.com/supplier-evidence');
INSERT INTO uav_model (uav_model_id, slug, url_uk, name_uk)
VALUES (1, 'test-uav', 'https://example.com/uav', 'Тестовий БПЛА');
INSERT INTO company_uav_model (company_id, uav_model_id) VALUES (522, 1);
INSERT INTO weapon (weapon_slug, url) VALUES ('test-weapon', 'https://example.com/weapon');
INSERT INTO company_weapon (company_id, weapon_slug) VALUES (570, 'test-weapon');

-- Company matches and open-source profiles.
-- Employer 1 is linked by INN; employer 2 has a confident name candidate (a registry-only company,
-- through a duplicate) and a weak one that must be ignored; employer 3 has a probable GUR match by name.
INSERT INTO company (company_id, inn, name_full_ru) VALUES
  (600, '1650000000', 'ООО «Алабуга»'), (601, NULL, 'Алабуга (дубль)');
INSERT INTO company_duplicate (company_id, canonical_id, method, confidence) VALUES (601, 600, 'inn', 1);
INSERT INTO employer_company_match (employer_profile_id, company_id, status, method, confidence) VALUES
  (1, 570, 'auto', 'inn_kpp', 1),
  (2, 601, 'candidate', 'egrul_name', 0.85),
  (2, 570, 'candidate', 'dadata_name', 0.5),
  (3, 522, 'candidate', 'dadata_name', 0.9);

INSERT INTO enrichment_run (run_id, label, method, started_at) VALUES
  (1, 'old', 'agent_websearch', '2026-10-01T00:00:00Z'),
  (2, 'new', 'exa_llm', '2026-10-07T00:00:00Z'),
  (3, 'draft', 'exa_llm', '2026-10-08T00:00:00Z');
INSERT INTO company_profile (company_id, run_id, status, activity_tags, products_ru, description_ru, created_at) VALUES
  (600, 1, 'published', ARRAY['Цивільна продукція'], NULL, 'Старый профиль [1].', '2026-10-01T00:00:00Z'),
  (600, 2, 'published', ARRAY['БпЛА'], ARRAY['Дроны «Герань»'], 'Завод в Елабуге [1][2][3].', '2026-10-07T00:00:00Z'),
  (600, 3, 'draft', ARRAY['Озброєння'], NULL, 'Черновик [1].', '2026-10-08T00:00:00Z'),
  (570, 2, 'draft', ARRAY['Озброєння'], NULL, 'Черновик КБП [1].', '2026-10-07T00:00:00Z');
INSERT INTO company_fact (run_id, company_id, local_id, claim_ru, url, source_type, quote, quote_verified, grade) VALUES
  (2, 600, 1, 'Завод в Елабуге', 'https://example.com/site', 'official_site', 'Завод в Елабуге', true, 'B'),
  (2, 600, 2, 'Непроверенное', 'https://example.com/unverified', 'news', 'нет на странице', false, 'C'),
  (1, 600, 1, 'Старый факт', 'https://example.com/old', 'registry', 'старое', true, 'A');
