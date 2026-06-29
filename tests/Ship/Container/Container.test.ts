import { beforeEach, describe, expect, it } from "bun:test";
import { Container } from "@ship/Container/Container";

describe("Container", () => {
	let container: Container;

	beforeEach(() => {
		container = new Container();
	});

	describe("set", () => {
		it("registers a raw value by string token", () => {
			container.set("db", "mock-db");
			expect(container.make<string>("db")).toBe("mock-db");
		});
	});

	describe("bind", () => {
		it("auto-wires a class with no deps", () => {
			class Greeter {
				greet() {
					return "hello";
				}
			}
			container.bind(Greeter);
			const g = container.make(Greeter);
			expect(g.greet()).toBe("hello");
		});

		it("auto-wires a class with class-token deps", () => {
			class Logger {
				log(msg: string) {
					return msg;
				}
			}
			class Service {
				constructor(public readonly logger: Logger) {}
			}
			container.bind(Logger);
			container.bind(Service, Logger);
			const s = container.make(Service);
			expect(s.logger).toBeInstanceOf(Logger);
			expect(s.logger.log("test")).toBe("test");
		});

		it("auto-wires a class with string-token deps", () => {
			class Service {
				constructor(public readonly db: string) {}
			}
			container.set("db", "mock-db");
			container.bind(Service, "db");
			const s = container.make(Service);
			expect(s.db).toBe("mock-db");
		});

		it("returns a singleton by default", () => {
			class Singleton {}
			container.bind(Singleton);
			const a = container.make(Singleton);
			const b = container.make(Singleton);
			expect(a).toBe(b);
		});
	});

	describe("register", () => {
		it("uses a custom factory", () => {
			container.register("custom" as string, [], () => ({ value: 42 }));
			expect(container.make<{ value: number }>("custom")).toEqual({ value: 42 });
		});
	});

	describe("make", () => {
		it("throws when token is not registered", () => {
			class Unknown {}
			expect(() => container.make(Unknown)).toThrow(/No binding registered/);
		});

		it("resolves deep dependency trees", () => {
			class A {}
			class B {
				constructor(public readonly a: A) {}
			}
			class C {
				constructor(public readonly b: B) {}
			}
			container.bind(A);
			container.bind(B, A);
			container.bind(C, B);
			const c = container.make(C);
			expect(c.b).toBeInstanceOf(B);
			expect(c.b.a).toBeInstanceOf(A);
		});
	});
});
