import type { Container } from "@ship/Container/Container";
import { createContainer } from "@ship/Container/registerServices";
import type { AppDB } from "@ship/database/connection";
import { appClient, db } from "@ship/database/connection";
import type { AppLogger } from "@ship/logger";
import { closeLogger, logger } from "@ship/logger";

export interface ConsoleContext {
	db: AppDB;
	log: AppLogger;
	container: Container;
	close(): Promise<void>;
}

export const createConsoleContext = (): ConsoleContext => ({
	db,
	log: logger,
	container: createContainer(db),
	async close(): Promise<void> {
		await closeLogger(logger);
		await appClient.end();
	},
});
