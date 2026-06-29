import type { ParsedCommandArgument, ParsedCommandOption, ParsedCommandSignature } from "./types";

const TOKEN_PATTERN = /\{([^{}]+)\}/g;
const NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_-]*$/;
const COMMAND_NAME_PATTERN = /^[^\s{}]+$/;

export function parseCommandSignature(signature: string): ParsedCommandSignature {
	const trimmedSignature = signature.trim();
	if (trimmedSignature.length === 0) {
		throw new Error("Command signature cannot be empty.");
	}

	const firstTokenIndex = trimmedSignature.indexOf("{");
	const commandName = (
		firstTokenIndex === -1 ? trimmedSignature : trimmedSignature.slice(0, firstTokenIndex)
	).trim();
	if (!COMMAND_NAME_PATTERN.test(commandName)) {
		throw new Error(`Invalid command name in signature: '${commandName}'.`);
	}

	const argumentsList: ParsedCommandArgument[] = [];
	const options: ParsedCommandOption[] = [];
	let match: RegExpExecArray | null;

	TOKEN_PATTERN.lastIndex = 0;
	while ((match = TOKEN_PATTERN.exec(trimmedSignature)) !== null) {
		const token = match[1]?.trim();
		if (!token) {
			throw new Error("Command signature contains an empty input token.");
		}

		if (token.startsWith("--")) {
			options.push(parseOption(token));
			continue;
		}

		argumentsList.push(parseArgument(token));
	}

	assertNoUnparsedTokens(trimmedSignature);
	assertArgumentOrder(argumentsList);

	return {
		name: commandName,
		arguments: argumentsList,
		options,
	};
}

function parseArgument(token: string): ParsedCommandArgument {
	const { definition, description } = splitDescription(token);
	const equalsIndex = definition.indexOf("=");
	const rawName = equalsIndex === -1 ? definition : definition.slice(0, equalsIndex);
	const defaultValue = equalsIndex === -1 ? undefined : definition.slice(equalsIndex + 1);
	const multiple = rawName.endsWith("*");
	const withoutMultiple = multiple ? rawName.slice(0, -1) : rawName;
	const optional = withoutMultiple.endsWith("?");
	const name = optional ? withoutMultiple.slice(0, -1) : withoutMultiple;

	assertName(name, `argument '${token}'`);
	if (defaultValue !== undefined && defaultValue.length === 0) {
		throw new Error(`Argument '${name}' default value cannot be empty.`);
	}
	if (defaultValue !== undefined && multiple) {
		throw new Error(`Argument '${name}' cannot be both variadic and defaulted.`);
	}

	return {
		name,
		description,
		required: !optional && defaultValue === undefined,
		multiple,
		...(defaultValue === undefined ? {} : { defaultValue }),
	};
}

function parseOption(token: string): ParsedCommandOption {
	const { definition, description } = splitDescription(token);
	const withoutPrefix = definition.slice(2);
	const separatorIndex = withoutPrefix.indexOf("|");
	const shortcut = separatorIndex === -1 ? undefined : withoutPrefix.slice(0, separatorIndex);
	const longDefinition =
		separatorIndex === -1 ? withoutPrefix : withoutPrefix.slice(separatorIndex + 1);
	const equalsIndex = longDefinition.indexOf("=");
	const rawName = equalsIndex === -1 ? longDefinition : longDefinition.slice(0, equalsIndex);
	const rawDefault = equalsIndex === -1 ? undefined : longDefinition.slice(equalsIndex + 1);
	const multiple = rawDefault === "*";
	const defaultValue =
		rawDefault === undefined || rawDefault === "*" || rawDefault === "" ? undefined : rawDefault;

	assertName(rawName, `option '${token}'`);
	if (shortcut !== undefined) {
		assertName(shortcut, `option shortcut '${token}'`);
	}

	return {
		name: rawName,
		...(shortcut === undefined ? {} : { shortcut }),
		description,
		requiresValue: equalsIndex !== -1,
		multiple,
		...(defaultValue === undefined ? {} : { defaultValue }),
	};
}

function splitDescription(token: string): { definition: string; description: string } {
	const separatorIndex = token.indexOf(":");
	if (separatorIndex === -1) {
		return { definition: token.trim(), description: "" };
	}

	return {
		definition: token.slice(0, separatorIndex).trim(),
		description: token.slice(separatorIndex + 1).trim(),
	};
}

function assertName(name: string, context: string): void {
	if (!NAME_PATTERN.test(name)) {
		throw new Error(`Invalid name for ${context}: '${name}'.`);
	}
}

function assertNoUnparsedTokens(signature: string): void {
	const withoutTokens = signature.replace(TOKEN_PATTERN, " ");
	const commandName = withoutTokens.trim();
	if (commandName.includes("{") || commandName.includes("}")) {
		throw new Error(`Malformed command signature: '${signature}'.`);
	}
}

function assertArgumentOrder(argumentsList: readonly ParsedCommandArgument[]): void {
	let foundOptionalOrVariadic = false;
	for (const argument of argumentsList) {
		if (foundOptionalOrVariadic && argument.required) {
			throw new Error(
				`Required argument '${argument.name}' cannot follow optional or variadic arguments.`,
			);
		}
		if (!argument.required || argument.multiple) {
			foundOptionalOrVariadic = true;
		}
	}
}
