export const RATE_LIMIT_PRESETS = {
	auth: { limit: 5, windowMs: 60_000 },
	api: { limit: 60, windowMs: 60_000 },
	public: { limit: 120, windowMs: 60_000 },
} as const;
