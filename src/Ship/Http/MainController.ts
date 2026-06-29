export type ResponseMeta = Record<string, unknown>;

export type ResponseEnvelope<TData, TMeta extends ResponseMeta = ResponseMeta> = {
	data: TData;
	meta: TMeta;
};

export interface PaginatedMeta extends ResponseMeta {
	total: number;
	cursor: string | null;
	hasMore: boolean;
}

export function wrapResponse<TData>(data: TData): ResponseEnvelope<TData> {
	return { data, meta: {} };
}

export function wrapPaginated<TData>(
	data: TData[],
	meta: PaginatedMeta,
): ResponseEnvelope<TData[], PaginatedMeta> {
	return { data, meta };
}

export abstract class MainController {
	protected static wrap<TData, TMeta extends ResponseMeta = ResponseMeta>(
		data: TData,
		meta: TMeta = {} as TMeta,
	): ResponseEnvelope<TData, TMeta> {
		return { data, meta };
	}
}
