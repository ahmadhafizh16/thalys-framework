import { AppError } from "@ship/Exceptions/AppError";
import type { QueryCriteria } from "@ship/Repository/BaseRepository";

export class RequestValidationError extends AppError {
	constructor(message: string, statusCode = 400) {
		super(statusCode, "INVALID_REQUEST", message, "errors.INVALID_REQUEST", { detail: message });
	}
}

export interface Allowlist {
	filterable: readonly string[];
	sortable: readonly string[];
	defaultSort?: { field: string; direction: "asc" | "desc" };
	defaultLimit?: number;
	maxLimit?: number;
}

export abstract class BaseRequest {
	protected static readonly allowlist: Allowlist = {
		filterable: [],
		sortable: [],
		defaultLimit: 20,
		maxLimit: 100,
	};

	static parseQuery(raw: Record<string, string | undefined>, allowlist?: Allowlist): QueryCriteria {
		const list = allowlist ?? this.allowlist;
		const filter = parseFilter(raw, list.filterable);
		const sort = parseSort(raw, list.sortable, list.defaultSort);
		const page = parsePage(raw, list.defaultLimit ?? 20, list.maxLimit ?? 100);

		return {
			filter: Object.keys(filter).length > 0 ? filter : undefined,
			sort: sort.length > 0 ? sort : undefined,
			page,
		};
	}

	static validateId(id: string, fieldName = "id"): string {
		const ID_REGEX = /^[A-Za-z0-9_-]+$/;
		if (!id || !ID_REGEX.test(id)) {
			throw new RequestValidationError(`Invalid format for '${fieldName}'.`);
		}
		return id;
	}
}

// ── Internal parsers ─────────────────────────────────────

function parseFilter(
	raw: Record<string, string | undefined>,
	allowed: readonly string[],
): Record<string, unknown> {
	const filter: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(raw)) {
		const match = key.match(/^filter\[(.+)]$/);
		if (!match?.[1] || !value) continue;
		const field = match[1];
		if (!allowed.includes(field)) {
			throw new RequestValidationError(`Filtering by '${field}' is not allowed.`);
		}
		filter[field] = value;
	}
	return filter;
}

function parseSort(
	raw: Record<string, string | undefined>,
	allowed: readonly string[],
	defaultSort?: { field: string; direction: "asc" | "desc" },
): { field: string; direction: "asc" | "desc" }[] {
	const sortParam = raw.sort;
	if (!sortParam) {
		return defaultSort ? [defaultSort] : [];
	}

	const parts = sortParam
		.split(",")
		.map((s) => s.trim())
		.filter(Boolean);
	return parts.map((part) => {
		const isDesc = part.startsWith("-");
		const field = isDesc ? part.slice(1) : part;
		if (!allowed.includes(field)) {
			throw new RequestValidationError(`Sorting by '${field}' is not allowed.`);
		}
		return { field, direction: isDesc ? ("desc" as const) : ("asc" as const) };
	});
}

function parsePage(
	raw: Record<string, string | undefined>,
	defaultLimit: number,
	maxLimit: number,
): { cursor?: string; limit?: number } {
	const cursor = raw["page[cursor]"];
	const limitParam = raw.limit ?? raw["page[limit]"];
	const limit = limitParam ? Math.min(Number(limitParam), maxLimit) : defaultLimit;

	return { cursor, limit };
}
