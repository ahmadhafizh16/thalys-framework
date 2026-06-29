import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

// PostgreSQL — primary application database (AppDb).
export const appClient = postgres(
	process.env.APP_DATABASE_URL ?? "postgres://localhost:30001/appdb",
);
export const db = drizzle(appClient);

// Type definitions for clean dependency injection typing.
export type AppDB = typeof db;

// Transaction client handed down by `db.transaction(async (tx) => ...)`.
export type AppTx = Parameters<Parameters<AppDB["transaction"]>[0]>[0];

// A Task accepts either the pooled connection or an in-flight transaction.
// This replaces `dbClient: any` while still letting Actions pass `tx` down.
export type AppClient = AppDB | AppTx;
