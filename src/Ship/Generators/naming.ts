export function pascalCase(str: string): string {
	return str
		.replace(/[-_\s]+(.)?/g, (_, c: string | undefined) => (c ? c.toUpperCase() : ""))
		.replace(/^(.)/, (_, c: string) => c.toUpperCase());
}

export function camelCase(str: string): string {
	const pascal = pascalCase(str);
	return pascal.charAt(0).toLowerCase() + pascal.slice(1);
}

export function kebabCase(str: string): string {
	return str
		.replace(/([a-z])([A-Z])/g, "$1-$2")
		.replace(/[\s_]+/g, "-")
		.toLowerCase();
}

export function snakeCase(str: string): string {
	return str
		.replace(/([a-z])([A-Z])/g, "$1_$2")
		.replace(/[\s-]+/g, "_")
		.toLowerCase();
}

export function pluralize(str: string): string {
	if (str.endsWith("y") && !/[aeiou]y$/i.test(str)) {
		return str.slice(0, -1) + "ies";
	}
	if (str.endsWith("s")) return str;
	return str + "s";
}
