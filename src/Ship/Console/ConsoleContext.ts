import type { AppDB } from "../database/connection";
import { db } from "../database/connection";
import type { AppLogger } from "../logger";
import { logger } from "../logger";

export interface ConsoleContext {
	db: AppDB;
	log: AppLogger;
}

export const createConsoleContext = (): ConsoleContext => ({
	db,
	log: logger,
});
