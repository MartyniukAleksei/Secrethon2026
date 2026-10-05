# Secrethon2026

Монорепо: React (Vite + TypeScript) на фронте, FastAPI на бэке. Деплой на Railway одним сервисом: FastAPI отдаёт и API (`/api/*`), и собранный фронт.

```
.
├── frontend/          # React + Vite + TS (npm, oxlint)
├── backend/           # FastAPI (uv, ruff, pytest)
│   ├── app/           # main.py (раздача фронта), api.py (эндпоинты /api), models.py, db.py
│   ├── migrations/    # миграции Alembic
│   └── tests/
├── docker-compose.yml # локальный Postgres
├── Dockerfile         # multi-stage: сборка фронта → образ с бэком и статикой
├── railway.json       # конфиг сборки/деплоя Railway
└── .github/workflows/ci.yml
```

## Локальная разработка

Нужны Node 22+, [uv](https://docs.astral.sh/uv/) и Docker (для локального Postgres).

```bash
# Postgres → localhost:5432
docker compose up -d

# Бэкенд → http://localhost:8000 (документация API: /docs)
cd backend
cp .env.example .env
uv sync
uv run alembic upgrade head
uv run uvicorn app.main:app --reload

# Фронтенд → http://localhost:5173 (запросы /api проксируются на :8000)
cd frontend
npm install
npm run dev
```

Проверки (те же, что в CI):

```bash
cd backend && uv run ruff check . && uv run ruff format --check . && uv run alembic check && uv run pytest
cd frontend && npm run lint && npm run build
```

Новые эндпоинты добавляйте в `router` в `backend/app/api.py`, чтобы они были под префиксом `/api`. Всё остальное отдаётся как SPA (`index.html`).

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
