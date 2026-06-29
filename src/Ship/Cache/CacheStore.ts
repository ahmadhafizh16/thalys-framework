export interface CacheStore {
	get<T>(key: string): Promise<T | null>;
	set(key: string, value: unknown, ttlMs?: number): Promise<void>;
	forget(key: string): Promise<void>;
	has(key: string): Promise<boolean>;
	flush(): Promise<void>;
	tag(...tags: string[]): TaggedCache;
}

export interface TaggedCache {
	get<T>(key: string): Promise<T | null>;
	set(key: string, value: unknown, ttlMs?: number): Promise<void>;
	forget(key: string): Promise<void>;
	flush(): Promise<void>;
}
