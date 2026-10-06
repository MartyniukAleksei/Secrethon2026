# Secrethon2026

Монорепо: React (Vite + TypeScript) на фронте, FastAPI на бэке. Деплой на Railway одним сервисом: FastAPI отдаёт и API (`/api/*`), и собранный фронт.

```
.
├── frontend/          # React + Vite + TS + React Router (npm, oxlint)
│   └── src/
│       ├── app/       # App (провайдеры + маршруты), pageContext
│       ├── api/       # типы и клиент /api
│       ├── data/      # загрузка датасета и DataProvider
│       ├── domain/    # доменные типы, форматирование, подписи (направления, уровни ВПК)
│       ├── state/     # глобальные фильтры (период, регион, направление)
│       ├── layout/    # оболочка: шапка с разделами, панель агента
│       ├── features/  # агент (заглушка по ключевым словам), палитра Ctrl K, шторка вакансии, тосты
│       ├── pages/     # страницы (company/ — профиль, вкладка на файл)
│       ├── components/, ui/, charts/  # переиспользуемые блоки, иконки, SVG-графики
│       └── styles/    # tokens.css (дизайн-система), base.css, ui.css
├── backend/           # FastAPI (uv, ruff, pytest)
│   ├── app/           # main.py (раздача фронта), api/ (роутеры /api), repository/ (SQL), db.py
│   ├── db/schema.sql  # снимок схемы базы пайплайна (только схема), для тестов
│   └── tests/         # fixtures/sample.sql — маленький набор данных для тестов
├── docker-compose.yml # локальный Postgres 18 для тестов
├── Dockerfile         # multi-stage: сборка фронта → образ с бэком и статикой
├── railway.json       # конфиг сборки/деплоя Railway
└── .github/workflows/ci.yml
```

## Локальная разработка

Нужны Node 22+, [uv](https://docs.astral.sh/uv/) и Docker (для тестовой базы).

```bash
# Бэкенд → http://localhost:8000 (документация API: /docs)
cd backend
cp .env.example .env      # и впишите DATABASE_URL базы с данными (см. «База данных»)
uv sync
uv run uvicorn app.main:app --reload

# Фронтенд → http://localhost:5173 (запросы /api проксируются на :8000)
cd frontend
npm install
npm run dev
```

Проверки (те же, что в CI):

```bash
docker compose up -d      # Postgres для тестов → localhost:5432
cd backend && uv run ruff check . && uv run ruff format --check . && uv run pytest
cd frontend && npm run lint && npm run build
```

Новые эндпоинты добавляйте в `backend/app/api/` и подключайте в `app/api/__init__.py`, чтобы они были под префиксом `/api`. SQL живёт в `backend/app/repository/`. Всё остальное отдаётся как SPA (`index.html`).

## Карта 2ГІС

Карта використовує MapGL JS API 2ГІС та офіційний плагін кластеризації.
Вона доступна в `/map`, на сторінці регіону та у вкладці «На карті» профілю.
Фільтри регіону й напряму обмежують роботодавців на карті.
Пошук у списку фільтрує карту за назвою, містом, регіоном або ІПН.
Натискання на позначку відкриває картку роботодавця, на кластер — наближає карту.
Доступні 2D/3D, масштабування, повний екран, показ усієї вибірки та фільтр санкцій.

Налаштування локально:

1. Скопіюйте `frontend/.env.example` у `frontend/.env`.
2. Вкажіть `VITE_2GIS_API_KEY` — ключ із доступом до **Map Tiles API**.
3. Перезапустіть Vite. Без ключа показується повідомлення про налаштування;
   список роботодавців залишається доступним.

На Railway задайте `VITE_2GIS_API_KEY` у Variables сервісу і перебудуйте образ.
Dockerfile приймає однойменний аргумент збірки. Для ручної збірки:

```bash
docker build --build-arg VITE_2GIS_API_KEY=your_browser_key -t secrethon2026 .
```

Ключ вбудовується у фронтенд під час збірки і є видимим у браузері.
Налаштуйте дозволені домени у кабінеті 2ГІС.
Документація: https://docs.2gis.com/en/mapgl/start/first-steps.

`GET /api/employers/map-points` читає координати з активних вакансій,
класифікованих останнім запуском як `confirmed` або `likely`.
Вакансії групуються за роботодавцем і парою `lat/lng`; кілька місць найму
одного роботодавця зберігаються. Відсутні або некоректні координати не
відображаються. Геокодування назв міст і вигаданих координат немає.
Це місця найму за даними джерел, а не перевірені адреси підприємств.
Лічильник на карті показує покриття координатами поточної вибірки.

## База данных

PostgreSQL, SQLAlchemy 2.0 (async, asyncpg), миграции через Alembic. Строка подключения всегда берётся из `DATABASE_URL`:

| Где | Откуда `DATABASE_URL` |
|---|---|
| Локально | `backend/.env` (копия `.env.example`, указывает на Postgres из `docker-compose.yml`) |
| Railway | переменная сервиса `DATABASE_URL=${{Postgres.DATABASE_URL}}`, приватная сеть Railway |
| CI | Postgres в service container GitHub Actions |

`.env` в git не коммитится. Каждый разработчик работает со своей локальной базой, а не с продовой.

Изменили модели в `backend/app/models.py`? Создайте миграцию и закоммитьте её:

```bash
cd backend
uv run alembic revision --autogenerate -m "add users"   # проверьте сгенерированный файл
uv run alembic upgrade head
```

CI проверяет (`alembic check`), что модели и миграции совпадают. На Railway миграции применяются автоматически перед каждым деплоем (`preDeployCommand` в `railway.json`). Если миграция упала, деплой не переключится.

### Данные

Таблицы: `companies`, `company_hiring` (новые вакансии по месяцам), `vacancies`, `supply_links` (поставщик → заказчик с уровнем уверенности), `signals`. API только на чтение: `GET /api/companies`, `/api/companies/{id}`, `/api/vacancies?company_id=`, `/api/supply-links`, `/api/signals`.

Пока сбора нет, база заполняется миграцией `seed demo snapshot` из `backend/migrations/data/demo_snapshot.json`: это данные кликабельного прототипа (названия предприятий настоящие, цифры, вакансии и связи выдуманы). Так одинаковые данные есть локально, в CI и на Railway. Когда появится реальный сбор, удалите демо-данные отдельной миграцией.

Фронт грузит весь датасет один раз (`frontend/src/data/load.ts`) и фильтрует на клиенте. Относительные даты («2 дні тому») и фильтр периода считаются от самой свежей записи в данных, а не от текущего времени.

Заглянуть в продовую базу: Railway → Postgres → вкладка **Data**, либо `railway connect Postgres` через [Railway CLI](https://docs.railway.com/guides/cli).

## CI/CD

- **CI** (GitHub Actions, на каждый PR и пуш в `main`): ruff, проверка миграций и pytest на Postgres для бэка, oxlint и сборка с typecheck для фронта, сборка Docker-образа со smoke-тестом.
- **CD** (Railway auto-deploy): Railway сам собирает `Dockerfile` при пуше в `main`, применяет миграции и проверяет `/api/health` (включая соединение с БД) перед переключением трафика.

### Настройка Railway (один раз)

1. Railway → **New Project → Deploy from GitHub repo** → выбрать этот репозиторий.
2. Settings сервиса:
   - **Root Directory**: пусто (корень репо). Конфиг подтянется из `railway.json`.
   - **Source → Branch**: `main`.
   - **Wait for CI**: включить, чтобы деплой шёл только после зелёного CI.
3. **Networking → Generate Domain**, чтобы получить публичный URL.
4. **+ New → Database → PostgreSQL**, затем в Variables сервиса приложения добавить `DATABASE_URL` = `${{Postgres.DATABASE_URL}}`.

Переменные окружения задаются в Railway → Variables. `PORT` Railway подставляет сам.
