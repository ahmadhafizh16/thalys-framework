export type ParsedCommandSignature = {
	readonly name: string;
	readonly arguments: readonly ParsedCommandArgument[];
	readonly options: readonly ParsedCommandOption[];
};

export type ParsedCommandArgument = {
	readonly name: string;
	readonly description: string;
	readonly required: boolean;
	readonly multiple: boolean;
	readonly defaultValue?: string;
};

export type ParsedCommandOption = {
	readonly name: string;
	readonly shortcut?: string;
	readonly description: string;
	readonly requiresValue: boolean;
	readonly multiple: boolean;
	readonly defaultValue?: string;
};
