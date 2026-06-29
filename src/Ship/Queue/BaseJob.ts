export abstract class BaseJob<TPayload = unknown> {
	abstract readonly name: string;
	abstract readonly maxAttempts: number;
	readonly queue = "default";
	readonly delay = 0;

	abstract handle(payload: TPayload): Promise<void>;

	async failed(_payload: TPayload, error: Error): Promise<void> {
		console.error(`Job ${this.name} failed after ${this.maxAttempts} attempts:`, error);
	}
}
