import { ConsoleCommand } from "@ship/Console/ConsoleCommand";
import type { ConsoleContext } from "@ship/Console/ConsoleContext";
import { jobRegistry } from "./JobRegistry";
import type { QueueDriver } from "./QueueDriver";
import { RedisQueueDriver } from "./RedisQueueDriver";

type WorkInput = { queue: string };

export class WorkCommand extends ConsoleCommand<WorkInput> {
	readonly signature = "thalys:work {--q|queue=default : Queue name to consume}";
	readonly description = "Start the background job worker";

	async handle(input: WorkInput, context: ConsoleContext): Promise<void> {
		const queueDriver = context.container.make("queue" as never) as QueueDriver;
		const queueName = input.queue;

		context.log.info({ queue: queueName }, "Worker started");

		queueDriver.process(async (job) => {
			const instance = jobRegistry.resolve(job.job);
			try {
				await instance.handle(job.payload);
				context.log.info({ job: job.job, id: job.id, attempt: job.attempts }, "Job completed");
			} catch (error) {
				context.log.error({ job: job.job, id: job.id, attempt: job.attempts, error }, "Job failed");
				throw error;
			}
		});

		await new Promise<void>((resolve) => {
			process.on("SIGINT", async () => {
				context.log.info("Worker shutting down...");
				await queueDriver.stop();
				if (queueDriver instanceof RedisQueueDriver) {
					await queueDriver.disconnect();
				}
				resolve();
			});
		});
	}
}
