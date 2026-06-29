import type { AppClient } from "@ship/database/connection";

export abstract class BaseTask {
	constructor(protected readonly dbClient: AppClient) {}

	abstract run(...args: unknown[]): Promise<unknown>;
}
