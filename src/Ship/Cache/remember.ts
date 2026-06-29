import type { CacheStore } from "./CacheStore";

export async function remember<T>(
	cache: CacheStore,
	key: string,
	ttlMs: number,
	fn: () => Promise<T>,
): Promise<T> {
	const cached = await cache.get<T>(key);
	if (cached !== null) return cached;
	const fresh = await fn();
	await cache.set(key, fresh, ttlMs);
	return fresh;
}
