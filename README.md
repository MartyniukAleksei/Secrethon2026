# Secrethon2026

Монорепо: React (Vite + TypeScript) на фронте, FastAPI на бэке. Деплой на Railway одним сервисом: FastAPI отдаёт и API (`/api/*`), и собранный фронт.

```
.
├── frontend/          # React + Vite + TS (npm, oxlint)
├── backend/           # FastAPI (uv, ruff, pytest)
│   ├── app/main.py    # API под /api + раздача frontend/dist
│   └── tests/
├── Dockerfile         # multi-stage: сборка фронта → образ с бэком и статикой
├── railway.json       # конфиг сборки/деплоя Railway
└── .github/workflows/ci.yml
```

## Локальная разработка

Нужны Node 22+ и [uv](https://docs.astral.sh/uv/).

```bash
# Бэкенд → http://localhost:8000 (документация API: /docs)
cd backend
uv sync
uv run uvicorn app.main:app --reload

# Фронтенд → http://localhost:5173 (запросы /api проксируются на :8000)
cd frontend
npm install
npm run dev
```

Проверки (те же, что в CI):

```bash
cd backend && uv run ruff check . && uv run ruff format --check . && uv run pytest
cd frontend && npm run lint && npm run build
```

Новые эндпоинты добавляйте в роутер `api` в `backend/app/main.py`, чтобы они были под префиксом `/api`. Всё остальное отдаётся как SPA (`index.html`).

## CI/CD

- **CI** (GitHub Actions, на каждый PR и пуш в `main`): ruff и pytest для бэка, oxlint и сборка с typecheck для фронта, сборка Docker-образа со smoke-тестом.
- **CD** (Railway auto-deploy): Railway сам собирает `Dockerfile` при пуше в `main` и проверяет `/api/health` перед переключением трафика.

### Настройка Railway (один раз)

1. Railway → **New Project → Deploy from GitHub repo** → выбрать этот репозиторий.
2. Settings сервиса:
   - **Root Directory**: пусто (корень репо). Конфиг подтянется из `railway.json`.
   - **Source → Branch**: `main`.
   - **Wait for CI**: включить, чтобы деплой шёл только после зелёного CI.
3. **Networking → Generate Domain**, чтобы получить публичный URL.

Переменные окружения задаются в Railway → Variables. `PORT` Railway подставляет сам.
