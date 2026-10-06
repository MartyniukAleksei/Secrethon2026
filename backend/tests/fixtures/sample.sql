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

INSERT INTO vacancy_classification (run_id, vacancy_id, level, raw_label, category) VALUES
  (2, 1, 'confirmed', 'точно', 'производство'),
  (2, 2, 'likely', 'вероятно', 'НИИ/КБ'),
  (1, 3, 'review', 'review_weak_signal', NULL),
  (2, 3, 'likely', 'вероятно', 'производство'),
  (1, 4, 'likely', 'likely', NULL),
  (2, 5, 'likely', 'вероятно', 'производство'),
  (1, 6, 'no', 'no', NULL);

INSERT INTO country (country_id, name_uk) VALUES (1, 'російська федерація');
INSERT INTO sanction_jurisdiction (code, name_uk) VALUES ('US', 'США'), ('UA', 'Україна');

INSERT INTO company (company_id, inn, name_full_uk, name_short_uk, country_id, address_uk, description_uk, sanctions_count, sanctions_count_intl) VALUES
  (570, '7105514574', 'АКЦІОНЕРНЕ ТОВАРИСТВО "КБП"', 'АТ "КБП"', 1, 'м. Тула', 'Розробник озброєння.', 2, 1),
  (522, '7704721192', 'АТ "НПО "ВИСОКОТОЧНІ КОМПЛЕКСИ"', 'АТ "ВК"', 1, NULL, NULL, 1, 1);

INSERT INTO company_section (company_id, section, url_uk) VALUES (570, 'rostec', 'https://war-sanctions.gur.gov.ua/rostec/1921');
INSERT INTO company_sanction (company_id, jurisdiction, is_sanctioned, listed_on) VALUES
  (570, 'US', true, '2022-06-02'), (570, 'UA', true, NULL), (522, 'US', true, NULL);
INSERT INTO company_edge (company_id, related_id, kind) VALUES (570, 522, 'parent');
