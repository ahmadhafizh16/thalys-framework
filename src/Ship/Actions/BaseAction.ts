import type { AppDB } from "@ship/database/connection";

export abstract class BaseAction {
	constructor(protected readonly db: AppDB) {}

	abstract execute(...args: unknown[]): Promise<unknown>;
}
