import type { AppClient } from "@ship/database/connection";
import { type SQL, and, asc, desc, eq, gt, sql } from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";

export interface PaginatedResult<T> {
	data: T[];
	meta: {
		total: number;
		cursor: string | null;
		hasMore: boolean;
	};
}

export interface QueryCriteria {
	filter?: Record<string, unknown>;
	sort?: { field: string; direction: "asc" | "desc" }[];
	page?: { cursor?: string; limit?: number };
	fields?: string[];
}

export abstract class BaseRepository<T extends PgTable> {
	constructor(
		protected readonly db: AppClient,
		protected readonly table: T,
	) {}

	/** Create a new repository instance scoped to a transaction. */
	withTransaction(tx: AppClient): this {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		return new (this.constructor as any)(tx, this.table);
	}

	// ── Core CRUD ──────────────────────────────────────────

	async findById(id: string | number): Promise<T["$inferSelect"] | null> {
		const rows = await this.db.select().from(this.table).where(eq(this.pk(), id)).limit(1);
		return rows[0] ?? null;
	}

	async findOne(where: SQL): Promise<T["$inferSelect"] | null> {
		const rows = await this.db.select().from(this.table).where(where).limit(1);
		return rows[0] ?? null;
	}

	async findMany(where?: SQL, limit = 100): Promise<T["$inferSelect"][]> {
		const query = this.db.select().from(this.table);
		if (where) query.where(where);
		return query.limit(limit);
	}

	async create(data: T["$inferInsert"]): Promise<T["$inferSelect"]> {
		const inserted = await this.db.insert(this.table).values(data).returning();
		const row = inserted[0];
		if (!row) throw new Error("Insert returned no row.");
		return row;
	}

	async update(where: SQL, data: Partial<T["$inferInsert"]>): Promise<T["$inferSelect"] | null> {
		const updated = await this.db.update(this.table).set(data).where(where).returning();
		return updated[0] ?? null;
	}

	async delete(where: SQL): Promise<boolean> {
		await this.db.delete(this.table).where(where);
		return true;
	}

	// ── Pagination ─────────────────────────────────────────

	async paginate(criteria: QueryCriteria): Promise<PaginatedResult<T["$inferSelect"]>> {
		const limit = Math.min(criteria.page?.limit ?? 20, 100);

		const countResult = await this.db
			.select({ count: sql<string>`count(*)` })
			.from(this.table)
			.where(this.buildWhereClause(criteria.filter));
		const total = Number(countResult[0]?.count ?? 0);

		const query = this.db.select().from(this.table);
		const where = this.buildWhereClause(criteria.filter);
		if (where) query.where(where);

		if (criteria.sort?.length) {
			for (const s of criteria.sort) {
				const col = this.col(s.field);
				query.orderBy(s.direction === "desc" ? desc(col) : asc(col));
			}
		}

		if (criteria.page?.cursor) {
			query.where(gt(this.pk(), criteria.page.cursor));
		}

		query.limit(limit + 1);
		const rows = await query;

		const hasMore = rows.length > limit;
		const data = rows.slice(0, limit);
		const lastRow = data[data.length - 1];
		const cursor =
			hasMore && lastRow ? String((lastRow as Record<string, unknown>)[this.pkName()]) : null;

		return { data, meta: { total, cursor, hasMore } };
	}

	// ── Helpers ────────────────────────────────────────────

	protected pk(): PgColumn {
		const name = this.pkName();
		const col = (this.table as Record<string, unknown>)[name];
		if (!col) throw new Error(`Primary key column "${name}" not found on table.`);
		return col as PgColumn;
	}

	protected pkName(): string {
		return "id";
	}

	protected col(fieldName: string): PgColumn {
		const col = (this.table as Record<string, unknown>)[fieldName];
		if (!col) throw new Error(`Column "${fieldName}" not found on table.`);
		return col as PgColumn;
	}

	protected buildWhereClause(filter?: Record<string, unknown>): SQL | undefined {
		if (!filter || Object.keys(filter).length === 0) return undefined;
		const conditions: SQL[] = [];
		for (const [key, value] of Object.entries(filter)) {
			if (value !== undefined && value !== null) {
				conditions.push(eq(this.col(key), value));
			}
		}
		if (conditions.length === 0) return undefined;
		if (conditions.length === 1) return conditions[0];
		return and(...conditions);
	}
}
