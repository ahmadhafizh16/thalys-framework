import { ConsoleCommand } from "@ship/Console/ConsoleCommand";
import type { ConsoleContext } from "@ship/Console/ConsoleContext";
import { FileGenerator } from "../FileGenerator";
import { kebabCase, pascalCase } from "../naming";

type MakeMiddlewareInput = { name: string; force?: boolean };

export class MakeMiddlewareCommand extends ConsoleCommand<MakeMiddlewareInput> {
	readonly signature =
		"thalys:make:middleware {name : Middleware name} {--f|force : Overwrite existing file}";
	readonly description = "Create a new Elysia middleware";

	handle(input: MakeMiddlewareInput, _context: ConsoleContext): void {
		const generator = new FileGenerator(process.cwd());
		const middlewareName = pascalCase(input.name) + "Middleware";
		const kebabName = kebabCase(input.name);

		const path = generator.generate({
			outputPath: `src/Ship/Http/Middleware/${middlewareName}.ts`,
			stubName: "middleware.stub",
			stubSubdir: "middleware",
			replacements: { middlewareName, kebabName },
			force: input.force,
		});

		_context.log.info({ path }, `Created ${middlewareName}`);
	}
}
