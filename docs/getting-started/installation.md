# Installation

This guide takes you from an empty directory to a running Thalys server connected to PostgreSQL. You will install dependencies, set up git hooks, configure the SSH tunnel for remote dev services, and start the dev server.

## Prerequisites

Thalys runs on the Bun runtime and targets PostgreSQL as its primary database. Before you begin, verify the following are installed and on your `PATH`:

| Requirement | Minimum version | Why |
| --- | --- | --- |
| **Bun** | 1.1 | Runtime, test runner, package manager, script host |
| **PostgreSQL** | 14 | Primary application database (AppDb) |
| **Redis** | 6 | Optional — enables distributed cache, queues, rate limiting |
| **MongoDB** | 4.4 | Structured log storage via `pino-mongodb` |
| **Git** | any | Required for the `lefthook` pre-commit hooks |

Check Bun is available:

```bash
bun --version
# 1.1.x or newer
```

::: tip Installing Bun
If you do not have Bun, install it with the official script:

```bash
curl -fsSL https://bun.sh/install | bash
```

Then restart your shell so `bun` is on your `PATH`.
:::

## Creating a project

Thalys is a project template rather than an installable CLI starter. Clone the repository and remove the upstream git history to make it your own:

```bash
git clone https://github.com/anomalyco/elysia.git thalys-app
cd thalys-app
rm -rf .git
git init
```

::: warning The repo is not a published package
Thalys does not (yet) ship as `npm create thalys`. You start from the repository directly. All framework code lives under `src/Ship/` — treat it as vendored infrastructure you own and can extend.
:::

## Installing dependencies

Thalys uses Bun's package manager. From the project root:

```bash
bun install
```

This installs everything declared in `package.json` — Elysia, Drizzle, Better Auth, Pino, ioredis, Commander, Biome, drizzle-kit, lefthook, and VitePress (for these docs).

## The `prepare` script

`bun install` automatically runs the `prepare` script defined in `package.json`:

```json
{
  "scripts": {
    "prepare": "lefthook install || true"
  }
}
```

This registers [lefthook](https://github.com/evilmartians/lefthook) git hooks from `lefthook.yml`. The pre-commit hook runs **Biome** (lint + format) and **`tsc --noEmit`** (typecheck) on staged files, so broken or unformatted code cannot be committed.

::: warning Hooks only fire inside a git repo
`lefthook install` no-ops when there is no `.git` directory. That is why the clone instructions above run `git init` before `bun install`. If you skip `git init`, the hooks never register and you lose the pre-commit safety net.
:::

The `|| true` ensures `bun install` does not hard-fail in environments where lefthook cannot write hooks (e.g. CI, sandboxes). In a real local checkout, lefthook installs cleanly.

## Running the dev server for the first time

The dev script starts the Elysia server in watch mode:

```bash
bun run dev
```

Under the hood this runs `bun run --watch src/index.ts`. When you save a file, Bun restarts the server automatically.

However, **the server will crash on boot until your environment is configured**. On first run you will likely see one of:

- `connect ECONNREFUSED 127.0.0.1:30001` — the Postgres tunnel is down.
- `Environment variable not found: APP_DATABASE_URL` — you have not created `.env` yet.

Both are expected. Proceed to the [SSH tunnel setup](#the-dev-server-tunnel-setup) below, then [Environment Setup](./environment) to create `.env`.

## The dev server tunnel setup

Local development connects to **remote** Postgres, Redis, and MongoDB instances over an SSH tunnel. The tunnel maps remote service ports onto non-standard `localhost` ports so that `.env` always points at `localhost`:

| Service | Remote port | Local tunnel port | Env var host |
| --- | --- | --- | --- |
| PostgreSQL | 5432 | `localhost:30001` | `APP_DATABASE_URL` |
| Redis | 6379 | `localhost:30002` | `REDIS_URL` |
| MongoDB | 27017 | `localhost:30003` | `MONGO_URL` |

### Why a tunnel?

Your team's real databases live on a shared dev/staging server. Connecting directly would mean every developer's `.env` references a different host, and credentials would have to live in the repo. The SSH tunnel lets everyone use the same `localhost:3000x` addresses while the actual connection is established with your personal SSH key.

### Setting up the tunnel

Add a `LocalForward` entry to your `~/.ssh/config` for the host that runs your dev databases:

```ssh-config
Host dev-db
  HostName db.yourcompany.com
  User ahmad
  # Postgres  → localhost:30001
  LocalForward 30001 127.0.0.1:5432
  # Redis     → localhost:30002
  LocalForward 30002 127.0.0.1:6379
  # MongoDB   → localhost:30003
  LocalForward 30003 127.0.0.1:27017
```

Then open the tunnel in a background SSH session:

```bash
ssh -N dev-db
```

`-N` tells SSH not to execute a remote command — it just holds the forwards open. Keep this session running in a terminal while you develop.

::: tip Verify the tunnel
With the SSH session active, you should be able to reach each service locally:

```bash
# Postgres
psql -h localhost -p 30001 -U ahmad -d thalys -c 'select 1'
# Redis (if installed)
redis-cli -p 30002 ping
```

If these hang, the tunnel is not up.
:::

### After the tunnel is up

1. Copy `.env.example` to `.env` (see [Environment Setup](./environment) for every variable).
2. Run migrations: `bun run db:migrate`
3. Seed default roles: `bun run command db:seed:roles`
4. Start the server: `bun run dev`

You should see:

```bash
🦊 Elysia running on Bun  host=localhost port=3000
```

## Package.json scripts overview

Every script goes through `bun`. Here is the full reference:

| Script | Command | What it does |
| --- | --- | --- |
| `dev` | `bun run --watch src/index.ts` | Start the HTTP server in watch mode (auto-restart on save) |
| `start` | `bun run src/index.ts` | Start the HTTP server once, no watch |
| `command` | `bun run command.ts` | Boot the Artisan-style console kernel (no HTTP server) |
| `test` | `bun test` | Run the full test suite (pure transformers, no DB needed) |
| `typecheck` | `tsc --noEmit` | Authoritative type correctness check — run after every change |
| `lint` | `biome check .` | Lint + format check (Biome) |
| `lint:fix` | `biome check --write .` | Auto-fix lint/format issues |
| `db:generate` | `drizzle-kit generate` | Generate a SQL migration from `*.schema.ts` changes |
| `db:migrate` | `drizzle-kit migrate` | Apply pending migrations to Postgres |
| `prepare` | `lefthook install \|\| true` | Register git hooks (runs automatically on `bun install`) |

### Common command invocations

```bash
bun run dev                                  # start dev server
bun run command --help                       # list all console commands
bun run command thalys:make:container Product --crud   # scaffold a CRUD container
bun run command db:seed:roles                # seed default roles + permissions
bun run command db:seed:users --count 50 --password password123
bun run command db:truncate users --force    # truncate a table by name
bun run db:generate                          # create a migration
bun run db:migrate                           # apply migrations
bun run typecheck                            # the check that catches what tests miss
bun run lint:fix                             # format + autofix
```

::: tip `typecheck` is non-negotiable
Tests in Thalys exercise pure transformers and do not require a database, so they will not catch a broken import or a stale type. `bun run typecheck` (which is `tsc --noEmit`) is the authoritative correctness check. The pre-commit hook runs it for you, but run it manually before pushing.
:::

## Verifying the install

Once the tunnel is up and `.env` is configured, a clean install should pass these checks in order:

```bash
bun run typecheck     # 0 errors
bun run lint          # 0 errors
bun run test          # all tests pass
bun run db:migrate    # migrations apply cleanly
bun run dev           # server boots, logs "🦊 Elysia running on Bun"
```

Then verify the HTTP layer:

```bash
curl http://localhost:3000/api/health
# { "status": "ok", "timestamp": "...", "checks": { ... } }
```

If the health endpoint responds, Thalys is fully installed and wired up. Head to [Your First Container](./first-container) to scaffold a CRUD domain.
