import type { Command } from "commander";
import type { ConsoleContext } from "./ConsoleContext";

export interface ConsoleCommand {
	readonly signature: string;
	readonly description: string;
	register(program: Command, context: ConsoleContext): void;
}
