# thalys:work

The `thalys:work` command starts the background queue worker process. It consumes jobs from the configured queue driver and executes them via the `JobRegistry`.

## Signature

```bash
thalys:work {--queue=default}
```

## Arguments

This command takes no positional arguments.

## Options

| Option | Shortcut | Default | Description |
| --- | --- | --- | --- |
| `--queue` | `-q` | `default` | The queue name to consume jobs from. |

## What it does

1. Resolves the `QueueDriver` from the DI container (in-memory in dev, Redis in production when `REDIS_URL` is set).
2. Starts consuming jobs from the specified queue via `queueDriver.process()`.
3. For each job, resolves the job handler class from the `JobRegistry` and calls `handle(payload)`.
4. Logs completion or failure for each job, including the job name, ID, and attempt number.
5. Runs until `SIGINT` (Ctrl+C), then gracefully shuts down: stops the driver and disconnects if using Redis.

## Example usage

```bash
# Start the default queue worker
bun run command thalys:work

# Consume from a specific queue
bun run command thalys:work --queue=emails

# Using the shortcut
bun run command thalys:work -q notifications
```

Output:

```bash
Worker started  queue=default
Job completed  job=SendWelcomeEmail  id=abc123  attempt=1
```

::: tip Run in a separate process
The worker is a long-running process — it does not exit. Run it separately from your HTTP server:

```bash
# Terminal 1 — HTTP server
bun run dev

# Terminal 2 — queue worker
bun run command thalys:work
```

In production, run the worker as a supervised process (e.g. via systemd, PM2, or Docker) alongside the web server.
:::

::: tip In-memory vs Redis
When `REDIS_URL` is not set, the worker uses the in-memory queue driver — jobs exist only in the current process and are lost on restart. In production with `REDIS_URL` set, the `RedisQueueDriver` persists jobs across restarts and allows multiple worker processes to share the queue.
:::

::: tip Graceful shutdown
The worker listens for `SIGINT` and shuts down gracefully: it stops accepting new jobs, finishes in-flight work, and disconnects from Redis. Use this in production by sending `SIGINT` (or `docker stop`) rather than `SIGKILL` to avoid losing in-progress jobs.
:::
