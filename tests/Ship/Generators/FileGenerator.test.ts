import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { FileGenerator } from "@ship/Generators/FileGenerator";

const TEST_DIR = join(import.meta.dir, "../../.tmp-generator-test");
const STUBS_DIR = join(TEST_DIR, "src/Ship/Generators/Stubs");
const CUSTOM_STUBS_DIR = join(TEST_DIR, "src/Ship/Generators/CustomStubs");

function setupTestDir() {
	rmSync(TEST_DIR, { recursive: true, force: true });
	mkdirSync(join(STUBS_DIR, "test"), { recursive: true });
	mkdirSync(join(CUSTOM_STUBS_DIR, "test"), { recursive: true });
}

describe("FileGenerator", () => {
	beforeEach(() => setupTestDir());
	afterEach(() => rmSync(TEST_DIR, { recursive: true, force: true }));

	it("reads a stub and replaces placeholders", () => {
		writeFileSync(join(STUBS_DIR, "test/hello.stub"), "Hello {{Name}}!");
		const generator = new FileGenerator(TEST_DIR);
		const path = generator.generate({
			outputPath: "output/hello.txt",
			stubName: "hello.stub",
			stubSubdir: "test",
			replacements: { Name: "World" },
		});
		expect(readFileSync(path, "utf-8")).toBe("Hello World!");
	});

	it("throws when output file already exists and force is false", () => {
		writeFileSync(join(STUBS_DIR, "test/a.stub"), "content");
		mkdirSync(join(TEST_DIR, "output"), { recursive: true });
		writeFileSync(join(TEST_DIR, "output/a.txt"), "existing");
		const generator = new FileGenerator(TEST_DIR);
		expect(() =>
			generator.generate({
				outputPath: "output/a.txt",
				stubName: "a.stub",
				stubSubdir: "test",
				replacements: {},
			}),
		).toThrow(/File already exists/);
	});

	it("overwrites when force is true", () => {
		writeFileSync(join(STUBS_DIR, "test/b.stub"), "new {{V}}");
		mkdirSync(join(TEST_DIR, "output"), { recursive: true });
		writeFileSync(join(TEST_DIR, "output/b.txt"), "old");
		const generator = new FileGenerator(TEST_DIR);
		const path = generator.generate({
			outputPath: "output/b.txt",
			stubName: "b.stub",
			stubSubdir: "test",
			replacements: { V: "content" },
			force: true,
		});
		expect(readFileSync(path, "utf-8")).toBe("new content");
	});

	it("uses custom stubs over defaults when available", () => {
		writeFileSync(join(STUBS_DIR, "test/c.stub"), "default");
		writeFileSync(join(CUSTOM_STUBS_DIR, "test/c.stub"), "custom {{X}}");
		const generator = new FileGenerator(TEST_DIR);
		const path = generator.generate({
			outputPath: "output/c.txt",
			stubName: "c.stub",
			stubSubdir: "test",
			replacements: { X: "yes" },
		});
		expect(readFileSync(path, "utf-8")).toBe("custom yes");
	});

	it("throws when stub is not found", () => {
		const generator = new FileGenerator(TEST_DIR);
		expect(() =>
			generator.generate({
				outputPath: "output/d.txt",
				stubName: "missing.stub",
				replacements: {},
			}),
		).toThrow(/Stub not found/);
	});

	it("insertIntoFile adds a line before a marker", () => {
		const filePath = join(TEST_DIR, "commands.ts");
		writeFileSync(filePath, "import A;\n// MARKER\nnew A(),\n// MARKER\n");
		const generator = new FileGenerator(TEST_DIR);
		generator.insertIntoFile(filePath, "// MARKER", "import B;");
		const content = readFileSync(filePath, "utf-8");
		expect(content).toContain("import B;\n// MARKER");
	});

	it("insertIntoFile is idempotent", () => {
		const filePath = join(TEST_DIR, "commands.ts");
		writeFileSync(filePath, "import A;\n// MARKER\n");
		const generator = new FileGenerator(TEST_DIR);
		generator.insertIntoFile(filePath, "// MARKER", "import B;");
		generator.insertIntoFile(filePath, "// MARKER", "import B;");
		const content = readFileSync(filePath, "utf-8");
		const count = content.split("import B;").length - 1;
		expect(count).toBe(1);
	});
});
