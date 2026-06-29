import type { BaseJob } from "./BaseJob";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type JobClass = new (...args: any[]) => BaseJob;

class JobRegistry {
	private readonly jobs = new Map<string, JobClass>();

	register(job: JobClass): void {
		const instance = new job();
		this.jobs.set(instance.name, job);
	}

	resolve(name: string): BaseJob {
		const JobClass = this.jobs.get(name);
		if (!JobClass) {
			throw new Error(`No job registered with name "${name}".`);
		}
		return new JobClass();
	}

	has(name: string): boolean {
		return this.jobs.has(name);
	}
}

export const jobRegistry = new JobRegistry();
