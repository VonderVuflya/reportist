# Architecture Overview

Справочник по тому, как устроен **reportist** и почему сделан именно
так. README — про то как запустить; этот документ — про то что
внутри, какие решения приняты и какие альтернативы рассматривались.
Обновляется вместе с кодом.

## 1. Project Structure

```text
reportist/
├── backend/                     # Bun + Hono (api + worker в одном образе)
│   ├── src/
│   │   ├── api.ts               # HTTP entry: cors, healthz, metrics, queue events
│   │   ├── app.ts               # Регистрация routes + OpenAPI doc + Scalar UI
│   │   ├── worker.ts            # BullMQ consumer: fetch → render → minio put → sse publish
│   │   ├── auth.ts              # better-auth конфиг + getSessionUser helper
│   │   ├── config.ts            # zod env schema
│   │   ├── logger.ts            # pino (pretty в dev, json в prod)
│   │   ├── metrics.ts           # prom-client registry + counters + histogram
│   │   ├── reports/             # Абстракция отчётов
│   │   │   ├── types.ts         # ReportDefinition<P, D> interface
│   │   │   ├── registry.ts      # Map<id, definition>
│   │   │   ├── runner.ts        # validate + fetch + render
│   │   │   ├── body-composition-dynamics/
│   │   │   └── gym-activity-summary/  # fetch + xlsx + pdf template (hono/jsx)
│   │   ├── renderers/           # xlsx (exceljs), pdf (puppeteer-core)
│   │   ├── routes/              # OpenAPI routes: clients, reports, runs
│   │   ├── sse/                 # hub (subscriber) + publisher (Redis pub/sub)
│   │   ├── queue/               # BullMQ queue singleton + job types
│   │   ├── storage/minio.ts     # minio client + put/get/stat
│   │   ├── middleware/rate-limit.ts
│   │   └── db/
│   │       ├── client.ts        # postgres (porsager) для приложения
│   │       └── migrate.ts       # pg.Client raw SQL runner
│   ├── migrations/*.sql         # Идемпотентные миграции по номерам
│   ├── scripts/
│   │   ├── seed.ts              # faker-based демо-данные (idempotent)
│   │   └── export-openapi.ts    # boots app без listen, dumps spec
│   ├── Dockerfile               # multi-stage, chromium в runner, entrypoint
│   └── docker-entrypoint.sh     # api / worker / migrate диспетчер
├── frontend/                    # React 19 + Vite + TanStack Query + shadcn/ui
│   ├── Dockerfile               # Vite build → nginx:alpine runner
│   ├── nginx.conf               # SPA fallback + reverse proxy /api → backend
│   ├── components.json          # shadcn/ui registry config
│   └── src/
│       ├── App.tsx              # AuthForm / UserView switch
│       ├── index.css            # Tailwind v4 + shadcn theme tokens
│       ├── auth/client.ts       # better-auth/react client
│       ├── lib/utils.ts         # cn() helper (clsx + tailwind-merge)
│       ├── components/ui/       # shadcn/ui primitives (Card, Table, Select, ...)
│       ├── api/
│       │   ├── fetcher.ts       # customFetch с credentials: include
│       │   ├── runs.ts          # downloadRun (blob + saveAs)
│       │   └── generated/       # orval-generated hooks + models из OpenAPI
│       └── reports/
│           ├── ReportsPage.tsx  # форма + runs table + SSE subscribers
│           ├── ParamsForm.tsx   # генерация полей из JSON Schema
│           ├── NotificationGate.tsx
│           └── sse.ts           # useRunSSE hook + notifyIfHidden
├── docker-compose.yml           # prod-like (билды, Coolify-совместимый)
├── docker-compose.dev.yml       # dev: hot reload + сайдкары migrate + minio-init
├── lefthook.yml                 # pre-commit: gen:api + typecheck
├── .env.example
├── README.md                    # Как запустить
└── ARCHITECTURE.md              # Этот документ
```

Две **независимые** папки-пакета, без bun workspaces: у backend и
frontend нет общих зависимостей, контракт идёт через OpenAPI, а не
через импорт TypeScript-типов между пакетами. Каждый Dockerfile
собирается только из своей папки — быстрее билды, меньше coupling,
можно деплоить независимо. Корневой `package.json` — тонкий
оркестратор скриптов (`install:all`, `up:dev`, `gen:api`).

## 2. High-Level System Diagram

```
┌──────────┐        ┌─────────────┐        ┌──────────────┐
│ Frontend │◀──────▶│     API     │◀──────▶│   Postgres   │
│ React 19 │  HTTP  │ Bun + Hono  │        │  users,      │
│ TanStack │  +SSE  │  OpenAPI    │        │  runs,       │
│  Query   │        │             │        │  gyms/...    │
└──────────┘        └──┬───────┬──┘        └──────────────┘
                       │       │
                       │       │  pub/sub (run status)
                       │       ▼
                       │   ┌───────┐
                       │   │ Redis │
                       │   └───┬───┘
                       │       │ BullMQ queue
                       │       │
                       │       ▼
                       │   ┌──────────┐       ┌───────────┐
                       └──▶│  Worker  │──────▶│   MinIO   │
                  enqueue  │   Bun    │  put  │ (S3 API)  │
                           │+ headless│       │  reports/ │
                           │ chromium │       └───────────┘
                           └──────────┘
```

Пять runtime-процессов в dev compose: `postgres`, `redis`, `minio`,
`api`, `worker`. Плюс два одноразовых сайдкара — `migrate` (bun
install + migrations + seed) и `minio-init` (создание bucket'а через
`mc`) — оба стартуют, отрабатывают, exit 0. Api/worker ждут их через
`depends_on: service_completed_successfully`, поэтому
`docker compose up` из пустых volume'ов поднимается одной командой
без ручных шагов.

Полная инвентаризация сервисов — в
[docker-compose.dev.yml](docker-compose.dev.yml) и
[docker-compose.yml](docker-compose.yml).

## 3. Principles

Два правила, которые держат прототип в рабочем состоянии и понятном
виде.

**Инкрементальные коммиты.** В коммит попадает только код, у которого
есть реальный runtime caller в этом же коммите. Никаких «миграционных
раннеров на перспективу», никаких stub-функций без вызывающей стороны.
Если при написании файла видно что он никем не импортируется в
текущем срезе — это сигнал, что его место в следующем коммите.

Живой пример: `ensureBucket()` в
[storage/minio.ts](backend/src/storage/minio.ts) существовал пока был
lazy-контракт «worker сам создаёт bucket при старте». Как только
появился `minio-init` сайдкар, функция и её caller удалены целиком —
не оставлены «на всякий случай».

**Вертикальные срезы.** Каждый шаг — полная фича: backend + миграция
(если нужна) + фронт-экран + ручной smoke test. После каждого шага
проект собирается и запускается в браузере. Не копим backend без
фронта или фронт без API. Это естественный gate на «код без runtime
caller не попадает в коммит»: если в срезе нечего подключить на
frontend — значит на backend написано лишнее.

## 4. Core Components

### 4.1. Frontend

**Name:** Reportist Web App

**Description:** Single-page application для работы с платформой
отчётов. Позволяет зарегистрироваться / залогиниться, выбрать отчёт
из списка, сгенерировать форму параметров динамически из
`paramsSchema`, запустить асинхронный run, получать real-time
обновления статуса через SSE (с браузерной нотификацией при
завершении в фоне), скачать готовый файл.

**Technologies:** React 19, Vite, TanStack Query 5,
`better-auth/react`, orval (кодген клиента из OpenAPI),
**Tailwind CSS v4** (через `@tailwindcss/vite` plugin),
**shadcn/ui** примитивы (Button / Card / Input / Label / Select /
Table / Badge / RadioGroup / Separator), построенные на Radix UI.
Тема light/dark на CSS-переменных (`--background`, `--foreground`,
`--primary`, `--destructive`, ...), радиусы/цвета задаются одним
местом в [src/index.css](frontend/src/index.css). Иконки — lucide,
font — Inter Variable через `@fontsource-variable/inter`. Helper
`cn()` для conditional classes — clsx + tailwind-merge.

**Deployment:** В prod — статическая сборка через Vite,
обслуживается nginx'ом в отдельном контейнере, который
**одновременно** reverse-proxy'ит `/api/*` в backend-сервис. Это
даёт same-origin на уровне браузера: better-auth cookies долетают
до api без cross-site SameSite-танцев, SSE работает через
`proxy_buffering off` без буферизации, никаких CORS preflight'ов
вообще. В dev — vite dev server с HMR и прямой api на
`localhost:3000`.

### 4.2. API

**Name:** Reportist HTTP API

**Description:** HTTP entry point для всех пользовательских операций:
управление сессиями через better-auth (`/api/auth/*`), список отчётов
(`GET /api/reports`), CRUD runs (`POST /api/runs`, `GET /api/runs`,
`GET /api/runs/:id`), скачивание результатов
(`GET /api/runs/:id/download`, проксированный поток из MinIO с
ownership check), real-time обновления статуса
(`GET /api/runs/:id/sse`). Также обслуживает `/healthz`, `/metrics`,
Scalar UI на `/reference` и OpenAPI spec на `/openapi.json`.

**Technologies:** Bun, Hono, `@hono/zod-openapi` (OpenAPI 3.1 через
zod), `@scalar/hono-api-reference`, better-auth, `postgres` (porsager),
ioredis (healthz + SSE), BullMQ QueueEvents (доменные метрики),
prom-client, pino.

**Deployment:** Один образ из
[backend/Dockerfile](backend/Dockerfile), запускается с
`command: ["api"]`, который в entrypoint-скрипте применяет миграции
и стартует `src/api.ts`.

### 4.3. Worker

**Name:** Reportist Report Worker

**Description:** BullMQ consumer для job'ов `reports:generate`. На
job делает: `UPDATE runs SET status='running'`, публикует событие в
Redis pub/sub канал `run:<id>`, запускает `runReport(reportId,
format, params, ctx)` (fetch из БД + render в Buffer), загружает
результат в MinIO, обновляет статус в БД, публикует финальное
событие. На failure обновляет `status='failed'` и пишет
`error_message`. Concurrency: 4 job'а на процесс — ограничено
параллелью puppeteer-рендеров.

**Technologies:** Bun, BullMQ, `postgres`, minio-js, exceljs (xlsx),
puppeteer-core + system chromium (pdf), hono/jsx (SSR для PDF
шаблонов), pino.

**Deployment:** Тот же образ что API, запускается с
`command: ["worker"]`. В prod-образе chromium устанавливается в
runner слое Dockerfile, в dev-образе — `apk add chromium` на старте
контейнера (однократно, кэшируется в volume).

### 4.4. Reports Abstraction

Ядро расширяемости — [backend/src/reports/types.ts](backend/src/reports/types.ts):

```ts
type ReportDefinition<P, D> = {
  id: string;
  name: string;
  description: string;
  paramsSchema: ZodType<P>;           // источник правды для UI-формы
  supportedFormats: ReportFormat[];   // 'xlsx' | 'pdf'
  fetch: (params: P, ctx) => Promise<D>;
  renderers: {
    xlsx?: (data: D, params: P) => Promise<Buffer>;
    pdf?:  (data: D, params: P) => Promise<Buffer>;
  };
};
```

Три осмысленных шага, каждый изолирован:

1. **Валидация параметров** — `paramsSchema.safeParse(rawParams)` в
   [reports/runner.ts](backend/src/reports/runner.ts). Тот же объект
   через `z.toJSONSchema()` отдаётся фронту как `paramsSchema`
   внутри ReportMeta и используется для автогенерации формы. Один
   источник правды, два consumer'а.
2. **Fetch** — чистая функция `(params) → data`. Никакого рендеринга,
   только SQL / HTTP. Легко тестируется без I/O браузера.
3. **Render** — `(data, params) → Buffer`. Чистая функция, принимает
   готовые данные и формат. Один отчёт может иметь несколько
   рендереров; `supportedFormats` — whitelist того что реально есть.

Реестр — [registry.ts](backend/src/reports/registry.ts), тонкая
`Map<id, definition>`. Новый отчёт регистрируется одной строкой.

**Добавление нового отчёта:**

1. Создать папку `backend/src/reports/<id>/` с файлом `index.ts`,
   который экспортирует `ReportDefinition`:

   ```ts
   import { z } from '@hono/zod-openapi';
   import { renderXlsx } from '../../renderers/xlsx.ts';
   import type { ReportDefinition } from '../types.ts';

   const paramsSchema = z.object({
     period: z.string().openapi({ description: 'Reporting period' }),
     metric: z.enum(['sales', 'revenue']),
   });

   type Params = z.infer<typeof paramsSchema>;
   type Data = { /* whatever fetch returns */ };

   const definition: ReportDefinition<Params, Data> = {
     id: 'my-report',
     name: 'My Custom Report',
     description: 'Description shown in UI',
     paramsSchema,
     supportedFormats: ['xlsx'],
     async fetch(params, ctx) { /* SQL / HTTP */ },
     renderers: {
       async xlsx(data, params) { /* exceljs → Buffer */ },
     },
   };

   export default definition;
   ```

2. Если нужен PDF — создать `template.tsx` (hono/jsx SSR React) и
   `renderers.pdf` через `renderPdf(Template, data, params)`.

3. Зарегистрировать в [registry.ts](backend/src/reports/registry.ts):

   ```ts
   import myReport from './my-report';
   register(myReport);
   ```

Всё. Фронт автоматически подхватит новый отчёт через
`GET /api/reports`, сгенерит форму из `paramsSchema`, отправит
`POST /api/runs` с его id. Никаких правок фронта, никаких новых
роутов, никаких миграций.

### 4.5. Почему fetch и render разделены

Единственная декомпозиция, которая окупается уже на двух отчётах и
становится критичной на пяти:

- **Тестируемость.** Fetch — это SQL + мэппинг, прогоняется против
  тестовой базы. Render — чистое форматирование, кормится фикстурой.
- **Один источник данных, несколько форматов.** gym-activity-summary
  рендерится в xlsx и pdf из одного `GymActivityData`. Без
  разделения пришлось бы дублировать SQL в каждом renderer'е.
- **Естественный контракт.** В `fetch` передаётся `db` и `userId`;
  в рендерер — только data и params. Рендерер физически не может
  сделать SQL — компилятор не даст.

Детали — в
[backend/src/reports/runner.ts](backend/src/reports/runner.ts).

## 5. Key Decisions and Alternatives

### 5.1. Стек и ключевые выборы

| Слой | Решение | Почему |
|---|---|---|
| Runtime | Bun 1.x | Один рантайм для api, worker, migrate, seed, тулинга; нативный TSX; скорость старта |
| HTTP | Hono + `@hono/zod-openapi` | OpenAPI-first контракт вместо Hono RPC или tRPC — см. ниже |
| JSX для PDF | `hono/jsx` | React-совместимый синтаксис с SSR `.toString()` без тяжёлой react/react-dom зависимости в бэкенде |
| SQL (app) | `postgres` (porsager) | Типизированные template literals, тонкий клиент |
| SQL (migrations, auth) | `pg` | `postgres.js` не умеет multi-statement в extended query mode; `pg.Client` в simple mode нативно ест многостейтментные файлы |
| Auth | better-auth | Cookie-based sessions, совместимость с SSE (EventSource шлёт cookie), pg адаптер |
| Queue | BullMQ | Зрелый, redis-based, QueueEvents для observability без ручного IPC |
| Storage | MinIO + `minio-js` | S3-совместимость без AWS-зависимости в тесте |
| Logger | pino | Структурный JSON в prod, pretty в dev через `pino-pretty` transport |
| Metrics | prom-client | Стандарт индустрии; дефолтные process metrics бесплатно |
| Frontend | React 19 + Vite + TanStack Query | Ничего экзотического; `better-auth/react` для сессии |
| Styling | Tailwind CSS v4 + shadcn/ui + Radix UI | Tailwind v4 через `@tailwindcss/vite` — нулевая конфигурация, CSS-first темизация через `@theme`. shadcn/ui — не npm-библиотека, а генератор компонентов в `src/components/ui/`, которые остаются под контролем проекта |
| Prod frontend | nginx:alpine + reverse proxy | Один origin для `/` (статика) и `/api/*` (proxy в backend) → same-origin cookies + SSE streaming out of the box |
| API client | orval из OpenAPI | Единый источник правды — backend-zod-схемы; клиент генерится в pre-commit хуке |
| PDF | puppeteer-core + system chromium | React SSR → HTML → headless Chrome → PDF; покрывает случай «хочу красивый шаблон со стилями и графиком» без отдельного layout-движка |
| Deploy target | Coolify (self-hosted PaaS) | Docker-compose first-class, Traefik-based routing через `SERVICE_FQDN_<name>_<port>` магические env vars |

### 5.2. Почему OpenAPI-first, а не Hono RPC или tRPC

Hono RPC и tRPC дают end-to-end TypeScript типобезопасность одним
импортом — это мощно, но создаёт сильную связку backend и frontend
по рантайм-типам TypeScript. Для тестового прототипа, где хочется
показать как устроена доставка контракта до клиента в типичной
production системе, OpenAPI правильнее:

- Контракт существует **на диске** как `backend/openapi.json`, его
  можно прочитать вне TypeScript, использовать из другого языка,
  дать мобильным клиентам
- Генерация клиента — отдельный шаг (`orval`), который можно заменить
  на любой другой генератор без изменений в бэкенде
- В pre-commit хуке `gen:api` + `typecheck` обеспечивает что клиент
  всегда соответствует актуальному серверу — type-safety есть, просто
  через другую точку синхронизации

### 5.3. Почему две независимые папки без bun workspaces

Backend и frontend живут в `backend/` и `frontend/` как **отдельные
пакеты**, каждый со своим `bun.lock` и `node_modules`. Нет
`workspaces` в корневом package.json.

Причина: у них нет общих зависимостей. Контракт идёт через
OpenAPI-файл, а не через импорт TypeScript-типов между пакетами.
Каждый Dockerfile собирается только из своей папки — быстрее билды,
меньше coupling, можно деплоить независимо. Корневой `package.json` —
это только тонкий оркестратор скриптов.

### 5.4. Почему prod — same-origin через nginx reverse proxy

В prod frontend-контейнер (nginx) обслуживает не только статику,
но и **reverse-proxy'ит `/api/*` в backend-сервис**. Браузер видит
один origin для всего (`https://reportist.example.com`), api не
экспонируется наружу напрямую. Альтернатива — выставить api на
отдельный subdomain (`https://api.reportist.example.com`) и
полагаться на cross-origin CORS + SameSite cookies — была
рассмотрена и отвергнута.

Причины в пользу same-origin:

- **better-auth cookies работают без плясок.** `sameSite=lax`
  cookie гарантированно летит на same-origin запросы; на
  cross-origin пришлось бы включать `sameSite=none; secure=true` +
  сложные CORS credentials правила, плюс Safari ITP политики
  блокируют third-party cookies агрессивно.
- **SSE не требует CORS preflight'ов.** EventSource с
  `withCredentials` cross-origin иногда глючит в staging/dev из-за
  schema/port разницы; same-origin работает всегда.
- **Приватность `/metrics`.** Nginx на уровне proxy rule делает
  `location = /metrics { return 404; }`, публично endpoint не
  достижим. Prometheus scrape'ит api напрямую по внутреннему
  docker сетевому имени.
- **Один public endpoint, один TLS сертификат, одно место для
  WAF/rate-limit'ов.**

Минус — frontend-сервис становится критичным путём для api
трафика (если nginx упал — api недоступен, хотя backend процессы
живы). Приемлемо для прототипа: frontend — stateless nginx, любой
restart занимает секунды. В реальном проде reverse proxy выносится
на отдельный edge layer (Traefik / Envoy / managed LB), а frontend
и api становятся двумя отдельными upstream'ами того же LB — и
same-origin сохраняется за счёт host-based роутинга.

Детали nginx конфига — в [§12.5.3](#1253-frontend-dockerfile--nginx-reverse-proxy).

## 6. Data Stores

### 6.1. Postgres

**Type:** PostgreSQL 17

**Purpose:** Источник правды для всего состояния приложения —
пользователи, сессии, runs и фитнес-домен (gyms, clients,
measurements, visits). Используется двумя драйверами: `postgres.js`
(porsager) для app-кода и `pg.Client` для миграций (нужен simple
query mode ради multi-statement SQL-файлов) и как адаптер для
better-auth.

**Key Schemas:**

```
001_auth.sql           — user, session, account, verification (better-auth)
002_fitness_domain.sql — gyms, clients, measurements
003_runs.sql           — run_status enum, runs
004_visits.sql         — visit_activity enum, visits (+ индексы)
```

**Домен (фитнес):**

- `gyms` — залы (name, city, opened_at)
- `clients` — клиенты, FK на `gyms`, с gender/birth_date/joined_at
- `measurements` — замеры состава тела (вес, % жира, мышцы, вода,
  висцеральный жир, BMR, обхваты). Источник данных для отчёта
  body-composition-dynamics
- `visits` — посещения зала (started_at, duration_min, activity
  enum). Источник данных для отчёта gym-activity-summary

**Платформа:**

- `user`/`session`/`account`/`verification` — стандартные better-auth
  таблицы
- `runs` — один запуск отчёта: `user_id`, `report_id`, `format`,
  `params jsonb`, `status` (queued/running/completed/failed),
  `result_key` (ключ в minio), `error_message`. Минимальный набор
  колонок — каждая добавляется когда у неё появляется runtime
  caller. Отложено до следующих слоёв: `idempotency_key`,
  `request_id`, `expires_at`, `error_code`, `started_at/finished_at`
  — их пока никто не читает, нет смысла хранить

Схема живёт в [backend/migrations/](backend/migrations/) —
sql-файлы, применяются идемпотентным раннером
[backend/src/db/migrate.ts](backend/src/db/migrate.ts) через
`_migrations` tracking table.

### 6.2. Redis

**Type:** Redis 7

**Purpose:** Две независимые роли.

1. **BullMQ queue** — `reports:generate` очередь и все её внутренние
   структуры (waiting list, active set, completed/failed sorted
   sets, job hashes).
2. **Pub/sub для real-time обновлений** — канал `run:<id>`, через
   который worker публикует обновления статуса, а инстансы api
   подписываются для SSE fan-out. Отдельный ioredis subscriber и
   publisher, не шарятся с BullMQ (у BullMQ свои ioredis соединения
   под капотом).

### 6.3. MinIO

**Type:** MinIO (S3-совместимый object storage)

**Purpose:** Хранение артефактов отчётов (xlsx/pdf). Ключ формата
`reports/{userId}/{runId}.{format}`. Bucket приватный — скачивание
только через backend-проксированный stream (`GET /api/runs/:id/download`)
с ownership check. Pre-signed URL осознанно не используется — см.
раздел 8.

Bucket создаётся одноразовым сайдкаром `minio-init` через `mc mb
--ignore-existing`. Retention / expiry не настроены — прототип,
disk usage пока не рос.

## 7. External Integrations / APIs

В текущей версии внешних интеграций нет — все источники данных
локальные (Postgres для фитнес-домена). Абстракция отчётов
принципиально позволяет брать данные из чего угодно: `ReportDefinition.fetch`
это просто `(params, ctx) => Promise<Data>`, ctx содержит `db`, но
ничто не мешает туда добавить http клиента или fetch'и до внешних
API.

Прототип сознательно упрощает этот момент — задание разрешает
«локальная БД, публичный API, моковые данные», но вся архитектура
вокруг отчётов написана так, что переключить один отчёт на внешний
API — это смена `fetch` функции без изменения регистрации, rendering
pipeline'а или UI.

## 8. Async Run Flow

Полный путь одного запуска от клика до скачивания:

```
1. Frontend submit form
     POST /api/runs { reportId, format, params }
     │
     ▼
2. API (routes/runs.ts)
     validate params via ReportDefinition.paramsSchema
     INSERT INTO runs (status='queued') RETURNING id
     reportQueue.add('generate', { runId, reportId, format, params, userId })
     runsEnqueuedCounter.inc()
     → 202 { id, status: 'queued' }
     │
     ▼
3. Worker (worker.ts)
     UPDATE runs SET status='running'
     publishRunUpdate({ id, status: 'running' })  [→ Redis PUBLISH run:<id>]
     │
     ▼
4. Report execution (reports/runner.ts)
     def.fetch(params, { db, userId })  → GymActivityData
     def.renderers[format](data, params) → Buffer
     │
     ▼
5. MinIO
     putReport("reports/<userId>/<runId>.<format>", buffer, contentType)
     │
     ▼
6. Worker
     UPDATE runs SET status='completed', result_key=...
     publishRunUpdate({ id, status: 'completed', resultKey })
     │
     ▼
7. API QueueEvents listener (wired in api.ts)
     on 'completed' → runsFinishedCounter.inc + runDurationHistogram.observe
     │
     ▼
8. Frontend SSE subscriber (useRunSSE)
     EventSource('/api/runs/:id/sse') получает event → setQueryData merge
     if (document.hidden) notifyIfHidden() → browser notification
     if (terminal status) es.close()
     │
     ▼
9. User clicks Download
     GET /api/runs/:id/download
     owner check → minioClient.getObject → proxy stream → Response
     browser saves file, выставляет Content-Disposition filename
```

**Ключевые инварианты:**

- **Ownership check** везде где отдаём данные по `runs.id`: download,
  get, SSE. Делается одним `WHERE id = $1 AND user_id = $2` запросом.
- **Backend-proxy download** вместо pre-signed URL. Плюсы: auth на
  каждом скачивании, приватный bucket, нет pre-signed key management.
  Минус: егресс через наш api. Трейдофф приемлем для прототипа;
  заменяется на pre-signed локально в одном handler'е если упрёмся
  в пропускную способность.
- **Отмена скачивания** — через стандартную HTTP disconnect →
  outgoing body close → source stream destroy propagation. Явный
  `AbortController` не пишу, оно уже работает через Node streams.
- **Streaming генерации** (exceljs/pdf прямо в S3 stream) — **не
  делаем**. Наш xlsx 11 KB, pdf 67 KB — экономии нет, код сложнее.
  Вернёмся когда появится отчёт на десятки MB.

## 9. Contract Flow (zod → OpenAPI → orval)

```
backend/src/routes/*.ts           (zod schemas + createRoute)
  ↓ app.doc('/openapi.json', ...)
backend/scripts/export-openapi.ts (boots app без listen, dumps spec)
  ↓
backend/openapi.json              (committed, diffable)
  ↓ orval
frontend/src/api/generated/       (TanStack Query hooks + typed models)
  ↓
frontend/src/reports/ReportsPage.tsx  (useListReports, useCreateRun, ...)
```

Регенерация и typecheck подняты в pre-commit через
[lefthook.yml](lefthook.yml):

```yaml
pre-commit:
  commands:
    gen-api:
      run: bun run gen:api
      stage_fixed: true
    typecheck:
      run: bun run typecheck
```

`stage_fixed: true` автоматически добавляет обновлённый
`openapi.json` + `frontend/src/api/generated/*` в коммит, так что
клиент никогда не отстаёт от сервера. Ручной `gen:api` тоже работает
если надо обновить типы во время разработки без коммита.

## 10. Real-time (SSE + Redis pub/sub)

Задача: пользователь нажал Run, свернул вкладку, через пару секунд
должен получить browser-нотификацию.

**Fan-out через Redis pub/sub.** Worker и api — отдельные процессы,
поэтому нельзя просто `emit` в память. Worker пишет в канал
`run:<id>`, api читает.

- [backend/src/sse/hub.ts](backend/src/sse/hub.ts) — один shared
  ioredis subscriber, `Map<channel, Set<listener>>`. При первой
  подписке на канал делает `SUBSCRIBE`, при последней отписке —
  `UNSUBSCRIBE`. Не плодим connections.
- [backend/src/sse/publisher.ts](backend/src/sse/publisher.ts) —
  один shared publisher,
  `publishRunUpdate({ id, status, resultKey?, errorMessage? })`.

**SSE endpoint** `/api/runs/:id/sse` в
[routes/runs.ts](backend/src/routes/runs.ts):

1. Auth + owner check
2. Начальное состояние из БД → `event: run\ndata: <row>\n\n`
3. Подписываемся на `run:<id>`, перекидываем каждое сообщение в
   поток
4. **Race-guard re-read**: после подписки ещё раз читаем из БД и
   если статус изменился между шагами 2 и 3 — отправляем
   дополнительный event. Закрывает окно «worker уже опубликовал
   пока мы читали»
5. Keepalive `: ping\n\n` каждые 15 сек — не даёт прокси закрыть
   соединение
6. На `cancel` (клиент отвалился) — unsubscribe + clear keepalive

**Frontend** —
[frontend/src/reports/sse.ts](frontend/src/reports/sse.ts):

- `useRunSSE(runId, onUpdate)` — `EventSource` с `withCredentials:
  true` (шлёт better-auth cookie). На терминальный статус
  (completed/failed) закрывает соединение сам — чтобы браузер не
  переподключался автоматически
- `notifyIfHidden(title, body)` — вызывает `new Notification` только
  если `document.hidden` и permission granted
- `<NotificationGate />` в
  [NotificationGate.tsx](frontend/src/reports/NotificationGate.tsx)
  — кнопка «Enable notifications», показывается только когда
  `Notification.permission === 'default'`

В [ReportsPage.tsx](frontend/src/reports/ReportsPage.tsx) на каждый
active run (queued/running) рендерится невидимый
`<RunSubscriber>`, который держит SSE-подписку до терминального
состояния. На update делается `queryClient.setQueryData` patch в
списке runs.

Polling (`useListRuns({ refetchInterval: 1500 })`) оставлен как
fallback на случай если SSE оборвётся — работает поверх SSE, не
мешает.

**В prod SSE идёт через nginx reverse proxy**, поэтому в
[frontend/nginx.conf](frontend/nginx.conf) на `location /api/`
критично стоит `proxy_buffering off` +
`proxy_read_timeout 3600s` + `chunked_transfer_encoding on`. Без
этих трёх директив nginx буферизует event stream в памяти и
флашит его клиенту только при закрытии апстрим-соединения — с
точки зрения браузера SSE просто не работает в реальном времени.

## 11. Observability

| Сигнал | Где | Для кого |
|---|---|---|
| Structured logs | pino child loggers (`svc: 'api'`, `svc: 'worker'`) | Оператор в консоли / ELK |
| `/healthz` | `api.ts` — pg `SELECT 1` + ioredis `PING`, 200/503 | Kubelet probes, load balancer |
| `/metrics` | `api.ts` — prom-client text exposition | Prometheus scraper |
| Domain counters | `metrics.ts` — enqueued / finished{status} / duration histogram | Domain dashboards и алерты |

Метрики доменного уровня:

- `reportist_runs_enqueued_total{report_id, format}` — увеличивается
  в API при `queue.add`
- `reportist_runs_finished_total{report_id, format, status}` —
  увеличивается в API через BullMQ `QueueEvents` listener (events
  `completed`/`failed`), не требует отдельного /metrics в worker'е
- `reportist_run_duration_seconds{report_id, format}` histogram —
  `finishedOn - processedOn` из того же listener'а

Почему метрики живут в api, а не в worker'е: один scrape endpoint,
один процесс держит prom-client registry. Worker по сути — консьюмер,
его метрики доступны через BullMQ events и без отдельного HTTP
сервера. Если появится потребность в worker-internal метриках (RSS,
GC, puppeteer-browser-uptime) — добавляется тонкий Bun.serve на
отдельный порт.

### Rate limiting

POST /api/runs ограничен через
[middleware/rate-limit.ts](backend/src/middleware/rate-limit.ts):
fixed-window счётчик per-session-token, 10 req / 60 s, in-memory Map
с периодическим sweep'ом устаревших bucket'ов. На превышение — `429
{"error":"rate limit exceeded"}` + `Retry-After` + `X-RateLimit-*`
headers. Анонимные и non-POST запросы проходят без учёта (handler
сам вернёт 401).

Scale-out путь — подмена Map на redis `INCR+EXPIRE` в том же файле,
интерфейс `MiddlewareHandler` не меняется.

## 12. Deployment & Infrastructure

**Cloud Provider:** агностика (docker-compose работает локально и
на любом VPS/managed runtime с docker). В проде я бы разворачивал
на managed k8s (GKE/EKS) или на одну managed платформу вроде Fly.io
/ Railway, но это за рамками прототипа.

**Key Services Used:** docker-compose, postgres, redis, minio,
nginx (frontend static), headless chromium (worker).

**CI/CD Pipeline:** lefthook pre-commit hook (`gen:api` +
`typecheck`) гарантирует что клиент синхронизирован с сервером и
типы не сломаны. На уровне прод-CI (не настроено пока) очевидный
next step — GitHub Actions с тремя job'ами: lint/typecheck, build
docker images, push в registry.

**Monitoring & Logging:** pino JSON логи (`NODE_ENV=production`) —
ready to pipe в Loki / ELK. `/metrics` endpoint в Prometheus
формате — в prod добавляется scrape job, Grafana дашборд на
`reportist_runs_*` метриках.

### 12.1. Compose конфигурации

Две compose-конфигурации:

- [docker-compose.dev.yml](docker-compose.dev.yml) — hot reload
  (vite dev, bun `--hot`), volume mounts `./backend:/app`,
  `apk add chromium` в worker на старте, отдельный `migrate` сайдкар
  (migrate + seed), отдельный `minio-init` сайдкар
- [docker-compose.yml](docker-compose.yml) — production-like, всё
  через билд из [backend/Dockerfile](backend/Dockerfile) и
  [frontend/Dockerfile](frontend/Dockerfile), chromium installed в
  runner stage, entrypoint-скрипт делает `migrate && exec api`

### 12.2. Backend Dockerfile

[backend/Dockerfile](backend/Dockerfile) — multi-stage:

1. **deps** — `bun install --frozen-lockfile --production` в
   отдельном слое для кэша. `@faker-js/faker` поэтому лежит в
   `dependencies` (не `devDependencies`): seed запускается в prod
   entrypoint, faker нужен на runtime.
2. **runner** — `apk add chromium nss freetype harfbuzz
   ttf-freefont`, `PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser`,
   копирует node_modules из deps, `src/`, `migrations/`, `scripts/`,
   `package.json`, **`tsconfig.json`** (без него Bun не видит
   `jsxImportSource: "hono/jsx"` и падает на templates), и
   `docker-entrypoint.sh`
3. `ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]`,
   `CMD ["api"]`

[backend/docker-entrypoint.sh](backend/docker-entrypoint.sh) —
диспетчер на первый аргумент:

- `api` → `migrate → seed → exec api` (seed идемпотентный, на
  повторных запусках пропускает если `gyms` не пустой)
- `worker` → `exec bun run src/worker.ts`
- `migrate` → `exec bun run src/db/migrate.ts`
- fallthrough → `exec "$@"`

Один образ, две роли (api и worker) через `command: ["api"]` /
`command: ["worker"]` в compose. Worker зависит от
`api: service_healthy` → на момент старта worker'а миграции уже
применены, БД заселена, api отвечает 200 на `/healthz`.

### 12.3. Healthchecks

Все четыре инфраструктурных сервиса имеют healthchecks в prod
compose, чтобы `depends_on: service_healthy` работал и запускал
api/worker только после полной готовности зависимостей:

```yaml
postgres:
  test: ["CMD-SHELL", "pg_isready -U $$POSTGRES_USER -d $$POSTGRES_DB"]

redis:
  test: ["CMD", "redis-cli", "ping"]

minio:
  # В образе minio/minio НЕТ wget, только curl + mc → curl'им liveness endpoint
  test: ["CMD", "curl", "-fsS", "http://localhost:9000/minio/health/live"]

api:
  test: ["CMD", "bun", "-e",
         "fetch('http://localhost:3000/healthz')
          .then(r => process.exit(r.ok ? 0 : 1))
          .catch(() => process.exit(1))"]

frontend:
  # nginx:alpine слушает на 0.0.0.0 только (IPv4); `localhost` в Alpine
  # резолвится в ::1 (IPv6) → Connection refused. Используем 127.0.0.1.
  test: ["CMD", "wget", "--quiet", "--tries=1", "--spider",
         "http://127.0.0.1:80/"]
```

Для api `bun -e` выбран потому что он уже в базовом образе — не
надо ставить curl/wget отдельно. Все healthchecks имеют `start_period`
(для api — 30s, чтобы пережить миграции+seed на первом cold start).

### 12.4. Dev: migrate + seed sidecar

В dev compose entrypoint Dockerfile не применяется (используется
raw `oven/bun:1-alpine`), поэтому migrate и seed вынесены в
отдельный сайдкар:

```yaml
migrate:
  command: sh -c "bun install --frozen-lockfile
                  && bun run src/db/migrate.ts
                  && bun run scripts/seed.ts"
  depends_on:
    postgres: { condition: service_healthy }
```

Seed идемпотентный: [scripts/seed.ts](backend/scripts/seed.ts)
проверяет `COUNT(*) FROM gyms` и выходит с `[seed] skipped` если
данные уже есть. `SEED_FORCE=1` — принудительный re-seed с
truncate.

`api` и `worker` ждут `migrate: service_completed_successfully`,
так что зависимостной гонки нет.

### 12.5. Prod: frontend Dockerfile + nginx reverse proxy

[frontend/Dockerfile](frontend/Dockerfile) тоже multi-stage:

1. **build** — `FROM oven/bun:1-alpine`, `ARG VITE_API_URL`,
   `bun install --frozen-lockfile`, `bun run build` → `dist/`
2. **runner** — `FROM nginx:alpine`, копирует
   [frontend/nginx.conf](frontend/nginx.conf) в
   `/etc/nginx/conf.d/default.conf`, копирует `dist/` в
   `/usr/share/nginx/html`

#### 12.5.1. VITE_API_URL на build-time

Vite вшивает `import.meta.env.VITE_API_URL` в bundle на **этапе
билда**, это не runtime переменная. В prod-сценарии с nginx
reverse proxy мы хотим чтобы фронт делал запросы на тот же origin
(`/api/...`), поэтому `VITE_API_URL=""` — пустая строка, и
[src/api/fetcher.ts](frontend/src/api/fetcher.ts) фолбэкает на
relative path. Никаких cross-origin пыток.

#### 12.5.2. nginx.conf ключевые блоки

```nginx
# SPA fallback
location / {
    try_files $uri $uri/ /index.html;
    add_header Cache-Control "no-cache";
}

# Reverse proxy для API
location /api/ {
    proxy_pass http://api:3000;
    proxy_http_version 1.1;
    proxy_set_header Host              $host;
    proxy_set_header X-Real-IP         $remote_addr;
    proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;

    # SSE compatibility: keep-alive, no buffering, long timeouts
    proxy_buffering        off;
    proxy_cache            off;
    proxy_request_buffering off;
    proxy_read_timeout     3600s;
    proxy_send_timeout     3600s;
    chunked_transfer_encoding on;
}

# /metrics — internal only, публично 404
location = /metrics { return 404; }

# /healthz — passthrough для uptime-пробингов
location = /healthz { proxy_pass http://api:3000/healthz; }
```

Критично: `proxy_buffering off` + `proxy_read_timeout 3600s`
обязательно для SSE. Без них nginx копит event stream в памяти до
закрытия соединения и браузер ничего не видит в real-time.

Long-lived caching настроен на `/assets/` (Vite hashed имена):

```nginx
location /assets/ {
    add_header Cache-Control "public, max-age=31536000, immutable";
}
```

#### 12.5.3. Frontend Dockerfile + nginx reverse proxy

Про зачем этот выбор был сделан — см. [§5.4](#54-почему-prod--same-origin-через-nginx-reverse-proxy). Здесь
— как именно реализовано. Nginx стоит перед api, обслуживает
статику и reverse-proxy'ит `/api/*`. Один контейнер, один порт
наружу.

### 12.6. Coolify deployment

[docker-compose.yml](docker-compose.yml) совместим с Coolify
через его магические environment variables:

- **`SERVICE_FQDN_<NAME>_<PORT>`** в compose `environment:` →
  Coolify читает это на старте, генерирует FQDN (или использует
  заданный в UI), настраивает Traefik label'ы на роутинг
  `<FQDN> → <service>:<port>`, инжектит две дополнительные env
  var: `SERVICE_FQDN_<NAME>` (hostname без схемы) и
  `SERVICE_URL_<NAME>` (полный URL с `https://`).
- В нашем compose:
  - `api.environment.SERVICE_FQDN_API_3000: ${SERVICE_FQDN_API}` →
    вешает `api.example.com` на порт 3000 api-контейнера
  - `frontend.environment.SERVICE_FQDN_FRONTEND_80: ${SERVICE_FQDN_FRONTEND}`
    → вешает `example.com` на порт 80 nginx-контейнера

Код приложения читает `SERVICE_URL_*` (не FQDN!) потому что zod
`z.url()` требует схему:

```yaml
api:
  environment:
    AUTH_BASE_URL: ${SERVICE_URL_API}
    WEB_ORIGIN: ${SERVICE_URL_FRONTEND}

frontend:
  build:
    args:
      VITE_API_URL: ${SERVICE_URL_API}
```

Концептуально:

- `AUTH_BASE_URL` — **публичный URL api** (для better-auth
  redirect'ов и cookie domain) → `SERVICE_URL_API`
- `WEB_ORIGIN` — **origin фронта** (для CORS whitelist'а
  better-auth) → `SERVICE_URL_FRONTEND`
- `VITE_API_URL` build-arg — туда фронт шлёт fetch'и. В
  same-origin сценарии с reverse proxy можно оставить пустым (и
  фронт пойдёт на относительный `/api/*`), но если api и frontend
  на **разных** subdomain'ах — тогда build'им с
  `SERVICE_URL_API`.

**Обязательные env vars в Coolify UI** (что надо ввести руками
в project settings):

```
AUTH_SECRET=<32+ chars random>
MINIO_SECRET_KEY=<random>
SERVICE_FQDN_API=api.your-domain.com
SERVICE_URL_API=https://api.your-domain.com
SERVICE_FQDN_FRONTEND=your-domain.com
SERVICE_URL_FRONTEND=https://your-domain.com
```

Опциональные — имеют дефолты в compose (`:-reportist` и т.п.):
`POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`,
`MINIO_ACCESS_KEY`, `MINIO_BUCKET`.

**Resource limits** на каждом сервисе (`mem_limit`, `cpus`) —
Coolify respect'ит их, это даёт предсказуемое поведение на
shared-host машине без shouting match'ей за RAM. Security:
`security_opt: [no-new-privileges:true]` везде где не ломает
функционал (chromium в worker требует namespace capabilities,
поэтому там только no-new-privileges без остальных seccomp
ограничений).

**Граблi которые я поймал по пути** (фиксы уже в коде, просто
чтобы знать если всплывёт):

- `wget` **не существует** в образе `minio/minio` → healthcheck
  на wget падает, каскад обрывается на minio-init. Надо curl.
- nginx:alpine слушает только IPv4 → `http://localhost/`
  резолвится в `::1` (IPv6) → Connection refused в healthcheck.
  Надо `127.0.0.1`.
- `tsconfig.json` забыт в backend Dockerfile COPY → Bun не читает
  `jsxImportSource`, template.tsx требует `react/jsx-runtime`,
  api падает на импорте.
- `@faker-js/faker` в `devDependencies` + `bun install
  --production` → seed в prod entrypoint не находит faker.
  Решение — перенести в `dependencies`.
- Coolify .env-файл не раскрывает `${VAR}` внутри значений (это
  делает сам compose layer). Нельзя в Coolify UI писать
  `AUTH_BASE_URL=${SERVICE_URL_API}` — нужно либо оставить пустым
  и положиться на compose fallback, либо вписать значение
  напрямую.

## 13. Security Considerations

**Authentication:** Email + password через
[better-auth](backend/src/auth.ts) с cookie-based сессиями. Cookie
`better-auth.session_token` — `httpOnly`, `sameSite=lax`. Сессия
живёт в таблице `session`, удаление/истечение — через better-auth
background механику. В prod cookie должен быть `secure: true`
(сейчас `false` для dev HTTP, надо включить за TLS-терминатором).

**Authorization:** На уровне данных — ownership check
`WHERE id = $1 AND user_id = $2` во всех операциях над runs (get,
download, sse). Роли / ACL пока не нужны — single-user data plane,
отчёт принадлежит тому кто его запустил.

**CSRF:** SameSite=lax cookie + ownership check закрывают типичные
CSRF-векторы (внешний POST в `/api/runs` не отправит cookie cross-site,
а если даже отправит — создаст run у самого owner'а, не чужого).
Явный CSRF-token middleware не ставил.

**Data Encryption:** Нет at-rest encryption на уровне приложения —
полагаемся на инфраструктуру (managed Postgres + MinIO с SSE-S3 в
prod). In transit — TLS терминируется на reverse proxy (в прототипе
HTTP, в prod nginx/Caddy/ALB).

**Input validation:** Всё что приходит от клиента, валидируется
zod'ом до попадания в handler — `@hono/zod-openapi` делает это
автоматически для routes, rate limiter работает по session token.
SQL injection невозможен — используются только tagged template
literals `postgres.js` (параметры всегда $1/$2, никогда не
string-concatenated).

**Secrets:** `AUTH_SECRET` (32+ символов) и MinIO credentials
приходят через env. `.env` в gitignore, `.env.example` — шаблон.
В prod — managed secret store (Vault / Doppler / AWS Secrets
Manager), не захардкоженные compose переменные.

**Rate limiting:** POST /api/runs — 10 req / 60 s per session. См.
раздел 11.

## 14. Development & Testing Environment

**Local Setup:** см. [README.md](README.md). Основной dev flow —
`docker compose -f docker-compose.dev.yml up --build`, весь стек
поднимается одной командой с hot reload.

**Testing Frameworks:** Автоматических тестов нет — сознательное
решение (см. раздел 15). Есть ручной smoke-test чеклист:

```
[ ] curl -sS http://localhost:3000/healthz     → 200 ok/ok
[ ] Открыть http://localhost:5173              → форма login/register
[ ] Зарегистрировать пользователя              → переход на Reports page
[ ] Выбрать body-composition-dynamics          → форма из JSON Schema
[ ] Run → увидеть queued → completed           → скачать xlsx
[ ] Выбрать gym-activity-summary               → радио xlsx/pdf
[ ] Run в PDF → completed ≤ 3s                 → скачать → открыть
    → в PDF: заголовок, 4 metric cards, SVG-график daily visits,
      таблицы By activity и Top 5 clients
[ ] Свернуть вкладку → Run → browser notification после completed
[ ] Burst 12 POST /api/runs                    → 11-12 → 429 + Retry-After
[ ] curl -sS localhost:3000/metrics | grep reportist_runs
                                                → видно enqueued +
                                                  finished{completed}
```

**Code Quality Tools:** TypeScript strict mode на обоих пакетах
(`bun run typecheck`), lefthook pre-commit для `gen:api` +
`typecheck`. ESLint/Prettier на фронте, конфиг минимальный.

## 15. What's NOT Done and Why

- **Автоматические тесты** — нет отдельного тест-раннера. Решение
  сознательное: при фиксированном бюджете времени вложился в
  реальные фичи (SSE, PDF, observability), чем в тест-инфру которая
  бы покрыла два CRUD'а. Автотесты — очевидный next step, стартовая
  точка: integration-тест `reports/runner.ts` с фикстурными
  fetch-mocks, плюс unit-тест для rate limiter (чистые функции
  счётчика без I/O).
- **Streaming report generation** (exceljs/pdf прямо в S3 stream) —
  не делаем. Наши файлы по 10-70 KB, экономии нет, код усложняется.
- **Cancel run** — отдельный POST `/api/runs/:id/cancel` с
  прокидыванием `AbortSignal` через pg/puppeteer. Делается когда
  на фронте появится осмысленный progress UI — сейчас даже кнопке
  негде жить.
- **Idempotent POST /api/runs** — колонка `idempotency_key` в
  `runs` не добавлена пока никто её не читает. Естественный момент
  добавить — когда/если появятся retry'и с клиента.
- **Retention / expiry** файлов в MinIO — нет TTL, нет `expires_at`
  колонки, нет фоновых cleanup'ов. Прототип, disk usage не рос.
- **Классификация ошибок** (UserError / UpstreamError /
  Unrecoverable) — все failure'ы сейчас падают в `failed` без
  разделения. В прод пригодится, в прототипе `error_message`
  достаточно.
- **Правильный auth в SSE** — использую обычный cookie через
  `EventSource withCredentials: true`. Работает, но EventSource не
  умеет headers, поэтому Authorization-токены (если когда-то
  перейдём на Bearer) придётся передавать через query string или
  переключаться на WebSocket.
- **`/metrics` на worker'е** — не нужен, BullMQ QueueEvents даёт
  API всё что нужно про job'ы. Пригодится если захотим memory/CPU
  от worker-процесса отдельно.
- **Error boundary** и нормальная обработка failed runs на фронте
  — сейчас ошибка показывается как ellipsized текст в таблице runs,
  этого хватило для smoke-тестов.

## 16. Future Considerations / Roadmap

1. Integration-тесты `reports/runner.ts` + unit-тесты rate limiter
   — самый низкий effort с наибольшим covered behavior.
2. Cancel run flow целиком (POST cancel → AbortSignal в
   ReportContext → отмена в puppeteer/pg → `status='cancelled'`).
3. Второй real-time канал — worker progress («fetching data 30%»,
   «rendering xlsx 70%») через ту же SSE-инфру.
4. Retention: `expires_at` колонка + фоновый sweep в отдельном
   BullMQ repeatable job.
5. Prometheus + Grafana dashboard в dev compose (один сервис + один
   provisioned dashboard файл) — почти бесплатно при наличии
   /metrics.

## 17. Glossary

- **Run** — один запуск отчёта. Запись в таблице `runs` со
  статусом, параметрами и (после завершения) ссылкой на артефакт в
  MinIO.
- **Report definition** — объект, описывающий конкретный отчёт:
  `id`, `paramsSchema`, `fetch`, `renderers`. Регистрируется в
  runtime Map через одну строчку.
- **Report format** — xlsx / pdf. Один отчёт может поддерживать
  оба.
- **Race-guard re-read** — паттерн в SSE handler: после подписки на
  Redis канал ещё раз читаем состояние из БД и отправляем
  дополнительный event если статус изменился между начальным read'ом
  и подпиской. Закрывает окно потерянных сообщений.
- **Vertical slice** — срез кода, включающий backend + фронт +
  миграцию + smoke test, то есть полноценную working feature, а
  не слой отдельно.
- **Backend-proxy download** — скачивание файла через API, который
  стримит из MinIO с auth/ownership check, в противоположность
  pre-signed URL (которая даёт браузеру прямую ссылку на bucket).
- **Same-origin via reverse proxy** — prod-паттерн: frontend
  nginx-контейнер обслуживает статику на `/` **и** reverse-proxy'ит
  `/api/*` в backend. Браузер видит один origin → better-auth
  cookies работают без CORS-плясок, SSE streaming работает без
  cross-origin edge cases.
- **Coolify magic env vars** — `SERVICE_FQDN_<NAME>_<PORT>` в
  compose `environment:`, который Coolify читает как директиву
  «route этот FQDN через Traefik в этот сервис:порт» и в ответ
  инжектит `SERVICE_FQDN_<NAME>` (hostname) и `SERVICE_URL_<NAME>`
  (полный URL) в контейнеры на runtime.
