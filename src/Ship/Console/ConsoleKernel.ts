import { Command } from "commander";
import type { ConsoleCommand } from "./ConsoleCommand";
import type { ConsoleContext } from "./ConsoleContext";

export class ConsoleKernel {
	private readonly program = new Command();

	constructor(private readonly context: ConsoleContext) {
		this.program
			.name("command")
			.description("Custom CLI utilities for the Elysia Porto application")
			.version("1.0.0");
	}

	register(commands: readonly ConsoleCommand[]): void {
		for (const command of commands) {
			command.register(this.program, this.context);
		}
	}

	async run(argv: readonly string[]): Promise<void> {
		await this.program.parseAsync([...argv]);
	}
}
