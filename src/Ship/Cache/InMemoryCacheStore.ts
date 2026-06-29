import type { CacheStore, TaggedCache } from "./CacheStore";

interface CacheEntry {
	value: unknown;
	expiresAt: number | null;
	tags: string[];
}

export class InMemoryCacheStore implements CacheStore {
	private readonly store = new Map<string, CacheEntry>();

	async get<T>(key: string): Promise<T | null> {
		const entry = this.store.get(key);
		if (!entry) return null;
		if (entry.expiresAt !== null && Date.now() > entry.expiresAt) {
			this.store.delete(key);
			return null;
		}
		return entry.value as T;
	}

	async set(key: string, value: unknown, ttlMs?: number): Promise<void> {
		this.store.set(key, {
			value,
			expiresAt: ttlMs ? Date.now() + ttlMs : null,
			tags: [],
		});
	}

	async forget(key: string): Promise<void> {
		this.store.delete(key);
	}

	async has(key: string): Promise<boolean> {
		return (await this.get(key)) !== null;
	}

	async flush(): Promise<void> {
		this.store.clear();
	}

	tag(...tags: string[]): TaggedCache {
		return new InMemoryTaggedCache(this.store, tags);
	}
}

class InMemoryTaggedCache implements TaggedCache {
	constructor(
		private readonly store: Map<string, CacheEntry>,
		private readonly tags: string[],
	) {}

	async get<T>(key: string): Promise<T | null> {
		const entry = this.store.get(this.taggedKey(key));
		if (!entry) return null;
		if (entry.expiresAt !== null && Date.now() > entry.expiresAt) {
			this.store.delete(this.taggedKey(key));
			return null;
		}
		return entry.value as T;
	}

	async set(key: string, value: unknown, ttlMs?: number): Promise<void> {
		this.store.set(this.taggedKey(key), {
			value,
			expiresAt: ttlMs ? Date.now() + ttlMs : null,
			tags: this.tags,
		});
	}

	async forget(key: string): Promise<void> {
		this.store.delete(this.taggedKey(key));
	}

	async flush(): Promise<void> {
		for (const [key, entry] of this.store) {
			if (this.tags.some((t) => entry.tags.includes(t))) {
				this.store.delete(key);
			}
		}
	}

	private taggedKey(key: string): string {
		return `${this.tags.sort().join(":")}:${key}`;
	}
}
