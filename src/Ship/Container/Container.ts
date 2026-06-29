// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Constructable<T> = new (...args: any[]) => T;

interface Injectable<T> {
	dependencies: readonly (Constructable<unknown> | string)[];
	factory: (...args: unknown[]) => T;
}

export class Container {
	private readonly instances = new Map<Constructable<unknown> | string, unknown>();
	private readonly factories = new Map<Constructable<unknown> | string, Injectable<unknown>>();

	/** Register a raw value (e.g. the `db` pool instance). */
	set<T>(token: string, value: T): void {
		this.instances.set(token, value);
	}

	/** Shorthand: auto-wire constructor. 90% of registrations. */
	bind<T>(
		token: Constructable<T>,
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		...deps: (Constructable<unknown> | string)[]
	): void {
		this.factories.set(token, {
			dependencies: deps,
			factory: (...args: unknown[]) => new (token as new (...a: unknown[]) => T)(...args),
		} as Injectable<unknown>);
	}

	/** Full control: custom factory for the 10% that need special wiring. */
	register<T>(
		token: Constructable<T> | string,
		dependencies: readonly (Constructable<unknown> | string)[],
		factory: (...args: unknown[]) => T,
	): void {
		this.factories.set(token, { dependencies, factory } as Injectable<unknown>);
	}

	make<T>(token: Constructable<T> | string): T {
		const cached = this.instances.get(token);
		if (cached) return cached as T;

		const injectable = this.factories.get(token);
		if (!injectable) {
			throw new Error(
				`No binding registered for "${String(token)}". Did you forget to register it?`,
			);
		}

		const resolvedDeps = injectable.dependencies.map((dep) => {
			if (typeof dep === "string") {
				return this.instances.get(dep);
			}
			return this.make(dep); // class token → recursive resolve
		});

		const instance = injectable.factory(...resolvedDeps);
		this.instances.set(token, instance);
		return instance as T;
	}
}
