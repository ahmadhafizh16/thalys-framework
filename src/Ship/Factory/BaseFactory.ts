import { faker } from "@faker-js/faker";

export interface FactoryCreateFn<TInsert> {
	create(data: TInsert): Promise<unknown>;
}

export abstract class BaseFactory<TInsert> {
	protected readonly faker = faker;

	/** Define the default fake data for this entity. */
	abstract definition(): TInsert;

	/** Create one entity (not persisted). Override to customize per-field. */
	make(overrides?: Partial<TInsert>): TInsert {
		return { ...this.definition(), ...overrides };
	}

	/** Create N entities (not persisted). */
	makeMany(count: number, overrides?: Partial<TInsert>): TInsert[] {
		return Array.from({ length: count }, () => this.make(overrides));
	}

	/** Create one entity and persist it via a repository. */
	async create(repo: FactoryCreateFn<TInsert>, overrides?: Partial<TInsert>): Promise<unknown> {
		return repo.create(this.make(overrides));
	}

	/** Create N entities and persist them sequentially. */
	async createMany(
		count: number,
		repo: FactoryCreateFn<TInsert>,
		overrides?: Partial<TInsert>,
	): Promise<unknown[]> {
		const results: unknown[] = [];
		for (let i = 0; i < count; i++) {
			results.push(await repo.create(this.make(overrides)));
		}
		return results;
	}

	/** Set a fixed seed for deterministic output. */
	seed(value: number): this {
		this.faker.seed(value);
		return this;
	}
}
