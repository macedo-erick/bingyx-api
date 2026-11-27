# bingyx-api

REST and realtime API for Bingyx, a Christmas bingo drawn live. NestJS 11, Drizzle over
PostgreSQL, Keycloak for the organiser's sign-in.

## Running locally

```bash
cp .env.example .env
docker compose up -d postgres keycloak
yarn install
yarn db:migrate:dev
yarn dev
```

Or the whole stack, API included, in containers:

```bash
docker compose up --build
```

| Service | Address |
|---|---|
| API | http://localhost:8097/api |
| Health | http://localhost:8097/health |
| Metrics | http://localhost:8097/metrics |
| Keycloak | http://localhost:8098/auth (admin / admin) |
| PostgreSQL | localhost:5436 (bingyx / bingyx) |

Keycloak imports `bingyx.json` from the shared `auth` repository, which must be checked out
next to this project's parent folder (`../../auth`). Registration is open; create the organiser
account through the app.

## Players

Players never sign in. Joining through `/j/<code>` hands them a token the API signs with
`PLAYER_TOKEN_SECRET` (HS256, `PLAYER_TOKEN_TTL`, 14 days by default). Production must set its
own secret of at least 32 characters; the default exists only for local development.

## Schema changes

```bash
yarn db:generate     # writes drizzle/NNNN_*.sql from src/database/schema.ts
```

Rename the file descriptively, update its `tag` in `drizzle/meta/_journal.json`, and review the
SQL as its own diff. The app never runs DDL on its own; `migrate` applies pending migrations
before the API starts.

## Tests

```bash
yarn test
```

Integration tests start a throwaway PostgreSQL with Testcontainers, so Docker must be running.
