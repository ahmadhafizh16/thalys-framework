import { ConsoleCommand } from "@ship/Console/ConsoleCommand";
import type { ConsoleContext } from "@ship/Console/ConsoleContext";
import { FileGenerator } from "../FileGenerator";
import { kebabCase, pascalCase } from "../naming";

type MakeTestInput = { name: string; container?: string; force?: boolean };

export class MakeTestCommand extends ConsoleCommand<MakeTestInput> {
	readonly signature =
		"thalys:make:test {name : Test name} {--c|container= : Container name (omit for Ship tests)} {--f|force : Overwrite existing file}";
	readonly description = "Create a new test file";

	handle(input: MakeTestInput, _context: ConsoleContext): void {
		const generator = new FileGenerator(process.cwd());
		const testName = pascalCase(input.name);
		const fileName = `${kebabCase(input.name)}.test.ts`;

		let outputPath: string;
		if (input.container) {
			const container = pascalCase(input.container);
			outputPath = `tests/Containers/${container}/${fileName}`;
		} else {
			outputPath = `tests/Ship/${fileName}`;
		}

		const testPath = generator.generate({
			outputPath,
			stubName: "test.stub",
			stubSubdir: "tests",
			replacements: { TestName: `${testName}Test`, behavior: "work correctly" },
			force: input.force,
		});

		_context.log.info({ testPath }, `Created test file: ${outputPath}`);
	}
}
