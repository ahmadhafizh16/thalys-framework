/**
 * Lightweight Prometheus metrics registry.
 *
 * Supports three metric types: counter, histogram, gauge.
 * Produces Prometheus text exposition format — no external dependency.
 *
 * @see https://prometheus.io/docs/instrumenting/exposition_formats/
 */

type Labels = Record<string, string>;

function labelKey(labels: Labels): string {
	const entries = Object.entries(labels).sort(([a], [b]) => a.localeCompare(b));
	if (entries.length === 0) return "";
	return entries.map(([k, v]) => `${k}="${v}"`).join(",");
}

interface CounterState {
	value: number;
}

interface GaugeState {
	value: number;
}

interface HistogramState {
	buckets: Map<number, number>; // le → cumulative count
	sum: number;
	count: number;
}

const DEFAULT_BUCKETS = [1, 5, 10, 50, 100, 500, 1000, Number.POSITIVE_INFINITY];

export class MetricsRegistry {
	private readonly counters = new Map<string, Map<string, CounterState>>();
	private readonly gauges = new Map<string, Map<string, GaugeState>>();
	private readonly histograms = new Map<string, Map<string, HistogramState>>();
	private readonly helpText = new Map<string, string>();
	private readonly bucketsByMetric = new Map<string, number[]>();

	// ── Counter ──────────────────────────────────────────────

	counter(name: string, value: number, labels: Labels = {}, help?: string): void {
		if (help && !this.helpText.has(name)) this.helpText.set(name, help);

		let labelMap = this.counters.get(name);
		if (!labelMap) {
			labelMap = new Map();
			this.counters.set(name, labelMap);
		}

		const key = labelKey(labels);
		let state = labelMap.get(key);
		if (!state) {
			state = { value: 0 };
			labelMap.set(key, state);
		}
		state.value += value;
	}

	// ── Gauge ────────────────────────────────────────────────

	gauge(name: string, value: number, labels: Labels = {}, help?: string): void {
		if (help && !this.helpText.has(name)) this.helpText.set(name, help);

		let labelMap = this.gauges.get(name);
		if (!labelMap) {
			labelMap = new Map();
			this.gauges.set(name, labelMap);
		}

		const key = labelKey(labels);
		labelMap.set(key, { value });
	}

	// ── Histogram ────────────────────────────────────────────

	histogram(
		name: string,
		value: number,
		labels: Labels = {},
		buckets: number[] = DEFAULT_BUCKETS,
		help?: string,
	): void {
		if (help && !this.helpText.has(name)) this.helpText.set(name, help);
		if (!this.bucketsByMetric.has(name)) this.bucketsByMetric.set(name, buckets);

		let labelMap = this.histograms.get(name);
		if (!labelMap) {
			labelMap = new Map();
			this.histograms.set(name, labelMap);
		}

		const key = labelKey(labels);
		let state = labelMap.get(key);
		if (!state) {
			const bucketMap = new Map<number, number>();
			for (const b of buckets) bucketMap.set(b, 0);
			state = { buckets: bucketMap, sum: 0, count: 0 };
			labelMap.set(key, state);
		}

		state.sum += value;
		state.count += 1;
		for (const b of buckets) {
			if (value <= b) {
				state.buckets.set(b, (state.buckets.get(b) ?? 0) + 1);
			}
		}
	}

	// ── Format (Prometheus text exposition) ──────────────────

	format(): string {
		const lines: string[] = [];

		// Counters
		for (const [name, labelMap] of this.counters) {
			const help = this.helpText.get(name);
			if (help) {
				lines.push(`# HELP ${name} ${help}`);
			}
			lines.push(`# TYPE ${name} counter`);
			for (const [key, state] of labelMap) {
				lines.push(`${name}${key ? `{${key}}` : ""} ${state.value}`);
			}
		}

		// Gauges
		for (const [name, labelMap] of this.gauges) {
			const help = this.helpText.get(name);
			if (help) {
				lines.push(`# HELP ${name} ${help}`);
			}
			lines.push(`# TYPE ${name} gauge`);
			for (const [key, state] of labelMap) {
				lines.push(`${name}${key ? `{${key}}` : ""} ${state.value}`);
			}
		}

		// Histograms
		for (const [name, labelMap] of this.histograms) {
			const help = this.helpText.get(name);
			if (help) {
				lines.push(`# HELP ${name} ${help}`);
			}
			lines.push(`# TYPE ${name} histogram`);
			const buckets = this.bucketsByMetric.get(name) ?? DEFAULT_BUCKETS;

			for (const [key, state] of labelMap) {
				const labelPrefix = key ? `${key},` : "";
				for (const b of buckets) {
					const leStr = b === Number.POSITIVE_INFINITY ? "+Inf" : String(b);
					const count = state.buckets.get(b) ?? 0;
					lines.push(`${name}_bucket{${labelPrefix}le="${leStr}"} ${count}`);
				}
				lines.push(`${name}_sum${key ? `{${key}}` : ""} ${state.sum}`);
				lines.push(`${name}_count${key ? `{${key}}` : ""} ${state.count}`);
			}
		}

		return lines.join("\n") + "\n";
	}

	// ── Reset (for tests) ────────────────────────────────────

	reset(): void {
		this.counters.clear();
		this.gauges.clear();
		this.histograms.clear();
		this.helpText.clear();
		this.bucketsByMetric.clear();
	}
}

export const metricsRegistry = new MetricsRegistry();
