import { type Command, Option } from "commander";
import type { ConsoleContext } from "./ConsoleContext";
import { parseCommandSignature } from "./Signature/parseCommandSignature";
import type { ParsedCommandArgument, ParsedCommandOption } from "./Signature/types";

type CommandInput = Record<string, unknown>;

export abstract class ConsoleCommand<TInput extends CommandInput = CommandInput> {
	abstract readonly signature: string;
	abstract readonly description: string;

	register(program: Command, context: ConsoleContext): void {
		const parsedSignature = parseCommandSignature(this.signature);
		let command = program.command(parsedSignature.name).description(this.description);

		for (const argument of parsedSignature.arguments) {
			command = command.argument(
				formatArgument(argument),
				argument.description,
				argument.defaultValue,
			);
		}

		for (const option of parsedSignature.options) {
			command = command.addOption(buildOption(option));
		}

		command.action(async (...actionArguments: unknown[]) => {
			const input = buildInput(parsedSignature.arguments, actionArguments) as TInput;
			await this.handle(input, context);
		});
	}

	abstract handle(input: TInput, context: ConsoleContext): Promise<void> | void;
}

function buildInput(
	commandArguments: readonly ParsedCommandArgument[],
	actionArguments: readonly unknown[],
): CommandInput {
	const options = actionArguments.at(-1);
	if (!isCommandInput(options)) {
		throw new Error("Commander did not provide an options object to the command action.");
	}

	const input: CommandInput = { ...options.opts() };
	for (const [index, argument] of commandArguments.entries()) {
		const value = actionArguments[index];
		if (value !== undefined) {
			input[argument.name] = value;
		}
	}

	return input;
}

function formatArgument(argument: ParsedCommandArgument): string {
	const suffix = argument.multiple ? "..." : "";
	return argument.required ? `<${argument.name}${suffix}>` : `[${argument.name}${suffix}]`;
}

function buildOption(option: ParsedCommandOption): Option {
	const flags = formatOptionFlags(option);
	const commanderOption = new Option(flags, option.description);

	if (option.defaultValue !== undefined) {
		commanderOption.default(option.defaultValue);
	}

	if (option.multiple) {
		commanderOption.argParser((value: string, previous: string[] | undefined) => [
			...(previous ?? []),
			value,
		]);
		commanderOption.default([]);
	}

	return commanderOption;
}

function formatOptionFlags(option: ParsedCommandOption): string {
	const valueExpression = option.requiresValue ? ` <${option.name}>` : "";
	const longFlag = `--${option.name}${valueExpression}`;
	return option.shortcut === undefined ? longFlag : `-${option.shortcut}, ${longFlag}`;
}

type CommanderActionOptions = {
	opts(): Record<string, unknown>;
};

function isCommandInput(value: unknown): value is CommanderActionOptions {
	return (
		typeof value === "object" &&
		value !== null &&
		"opts" in value &&
		typeof value.opts === "function"
	);
}
