# reportist

Прототип платформы генерации отчётов. Тестовое задание.

Backend на Bun/Hono с OpenAPI-first контрактом, async pipeline через
BullMQ + MinIO, frontend на React 19 + TanStack Query (UI на
shadcn/ui + Tailwind CSS v4) с автогенерацией клиента из OpenAPI,
real-time статусы запусков через SSE поверх Redis pub/sub.

Домен узкий (фитнес — залы, клиенты, замеры, визиты), но вся
инфраструктура вокруг отчётов сделана расширяемой: новый отчёт — это
один файл в `backend/src/reports/<id>/` с `paramsSchema`, `fetch` и
`renderers`, плюс одна строчка регистрации. Фронт автоматически
подхватывает его из `GET /api/reports` и рендерит форму из JSON
Schema.

Подробнее про решения и trade-offs — в
[ARCHITECTURE.md](ARCHITECTURE.md).

## Что работает

- Регистрация / логин (email + password) через better-auth с
  cookie-based сессиями
- Два отчёта:
  - **Body composition dynamics** — динамика состава тела клиента
    за период (xlsx)
  - **Gym activity summary** — агрегаты по залу: визиты, уникальные
    посетители, разбивка по типам тренировок, топ-5 клиентов (xlsx
    с тремя листами / pdf через puppeteer + hono/jsx SSR)
- Async run flow: POST → row в `runs` → BullMQ job → worker
  генерирует → MinIO put → SSE-event → проксированный download с
  ownership check
- Real-time статусы через SSE (`/api/runs/:id/sse`) + Redis pub/sub
  fan-out между worker и api
- Browser notification если вкладка в фоне на момент завершения
- Автогенерация форм на фронте из `paramsSchema` отчёта
- UI на shadcn/ui + Tailwind CSS v4 (Card / Table / Badge / Select /
  RadioGroup) — light/dark themes через CSS-переменные
- Observability: `/healthz` (db + redis), `/metrics` (prom-client),
  структурные pino-логи
- Rate limiting на POST /api/runs (10 req / 60 s per session, 429 +
  Retry-After)
- Production-ready деплой на Coolify через reverse-proxy на nginx,
  все сервисы one-command `docker compose up`

## Quick start

Разработка идёт через
[docker-compose.dev.yml](docker-compose.dev.yml): он поднимает весь
стек (postgres, redis, minio, api, worker, frontend) из raw
`oven/bun:1-alpine` с bind mount'ами исходников и hot reload через
`bun --hot` и `vite`. Миграции и seed запускаются отдельным
сайдкаром `migrate`, bucket в MinIO — сайдкаром `minio-init`. Весь
стек поднимается одной командой из пустых volume'ов.

```bash
cp .env.example .env
# поправь AUTH_SECRET на что-нибудь длиной 32+ символов, остальное ок

docker compose -f docker-compose.dev.yml up --build
```

Первый запуск занимает 1-2 минуты — в worker-контейнер ставится
chromium для PDF-рендера через puppeteer. Последующие `up` —
секунды.

После старта:

- Frontend: http://localhost:5173
- API + Scalar UI: http://localhost:3000/reference
- MinIO console: http://localhost:9001 (логин `reportist` /
  `reportist-dev-secret`)
- `/healthz`, `/metrics` на том же API-порту

Изменения кода в `backend/src/**` и `frontend/src/**` подхватываются
на лету: Bun `--hot` soft-reload'ит модули api/worker без рестарта
процесса, Vite делает HMR на фронте.

### Prod-подобный запуск

[docker-compose.yml](docker-compose.yml) строит backend из
[backend/Dockerfile](backend/Dockerfile) (multi-stage, chromium в
runner-слое, entrypoint делает `migrate → seed → api`). Frontend
билдится в статику и обслуживается nginx, который **одновременно**
reverse-proxy'ит `/api/*` в backend (см. ниже).

```bash
docker compose up --build
```

В этом режиме api не экспонируется на хост — весь трафик идёт через
nginx:80 как одно происхождение. Это осознанный выбор ради
same-origin cookies для better-auth, см.
[ARCHITECTURE.md § Frontend Dockerfile + nginx](ARCHITECTURE.md#1253-frontend-dockerfile--nginx-reverse-proxy).

### Deploy на Coolify

`docker-compose.yml` готов под Coolify-магические переменные
`SERVICE_FQDN_API_3000` и `SERVICE_FQDN_FRONTEND_80`. Coolify
прокидывает Traefik-роуты на конкретные subdomains, а в контейнеры
инжектит `SERVICE_URL_API` / `SERVICE_URL_FRONTEND`, которые
подставляются в `AUTH_BASE_URL`, `WEB_ORIGIN`, `VITE_API_URL`
автоматически.

Обязательные env в Coolify UI:

```
AUTH_SECRET=<random 32+ chars>
MINIO_SECRET_KEY=<random 16+ chars>
SERVICE_FQDN_API=api.your-domain.com
SERVICE_URL_API=https://api.your-domain.com
SERVICE_FQDN_FRONTEND=your-domain.com
SERVICE_URL_FRONTEND=https://your-domain.com
```

Опционально (иначе дефолты из compose):
`POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`,
`MINIO_ACCESS_KEY`, `MINIO_BUCKET`.

Подробности — в
[ARCHITECTURE.md § Coolify deployment](ARCHITECTURE.md#1256-coolify-deployment).

## Команды верхнего уровня

| Команда | Что делает |
|---|---|
| `bun run install:all` | `bun install` в backend и frontend |
| `bun run up:dev` | полный dev стек в docker с hot reload |
| `bun run down:dev` | остановить dev стек |
| `bun run up` | prod compose (build всех образов) |
| `bun run down` | остановить prod стек |
| `bun run gen:api` | экспорт OpenAPI + генерация orval-клиента |
| `bun run typecheck` | `tsc --noEmit` в обоих пакетах |

Seed идемпотентный — проверяет `COUNT(*) FROM gyms` и выходит с
`[seed] skipped` если данные уже есть. `SEED_FORCE=1` внутри
`migrate`-контейнера (dev) или `api`-контейнера (prod) принудительно
пересоздаёт демо-данные.

## Troubleshooting

**Порт 3000/5173/5432/6379/9000 занят.** Override в `.env`:

```
API_PORT=3100
WEB_PORT=5174
POSTGRES_PORT=5433
```

**`/healthz` отвечает 503 с `redis: fail` сразу после старта.** Это
гонка при холодном старте ioredis. Если видишь только на первом hit
и потом 200 — всё норм. Если стабильно — проверь что сервис `redis`
в compose здоров (`docker compose ps`) и что healthcheck прошёл.

**Browser notification не приходит.** Проверь что дал permission
(кнопка «Enable notifications» в ReportsPage). `notifyIfHidden` по
дизайну показывает тост только когда `document.hidden === true` —
если вкладка открыта, notification не будет. Это намеренно.

**Пустой список клиентов или отчёт falls с «not found».** Seed не
отработал. В dev проверь логи `docker logs reportist-migrate-1`;
в prod посмотри api entrypoint-лог (`[entrypoint] seeding demo
data`). Если видишь `[seed] skipped` — данные уже были; можно
`SEED_FORCE=1 bun run seed` на host'е или внутри контейнера.

**Первый запуск worker'а очень долгий.** Нормально: в dev `apk`
ставит chromium + сопутствующие библиотеки (~100 MB). Один раз на
volume. В prod chromium ставится в runner-слое Dockerfile — один
раз при билде образа.

**Coolify deploy: `minio is unhealthy`.** В `minio/minio` образе
**нет** wget — только curl. Healthcheck в compose использует `curl
-fsS http://localhost:9000/minio/health/live`.

**Coolify deploy: api крашится с `Invalid URL`.** В
`AUTH_BASE_URL` / `WEB_ORIGIN` попал FQDN без схемы (например,
`reportist.example.com` вместо `https://reportist.example.com`).
Compose читает их из `SERVICE_URL_*` магических переменных (со
схемой), `SERVICE_FQDN_*` — только для Traefik-роутинга. Не
переопределяй вручную.

**Coolify deploy: `Cannot find module 'react/jsx-runtime'` в api
или worker.** `tsconfig.json` не попал в образ → Bun не читает
`jsxImportSource: "hono/jsx"` и падает. Убедись что
[backend/Dockerfile](backend/Dockerfile) содержит
`COPY package.json tsconfig.json ./`.

**Coolify deploy: `Cannot find module '@faker-js/faker'`.** faker
лежит в `dependencies` (не `devDependencies`) — он нужен на
runtime в prod entrypoint для seed'а. Если сломалось — проверь
[backend/package.json](backend/package.json).

## Лицензия

Прототип для тестового задания, без лицензии. Не для
прод-использования как есть.
