import { ConsoleCommand } from "@ship/Console/ConsoleCommand";
import type { ConsoleContext } from "@ship/Console/ConsoleContext";
import { FileGenerator } from "../FileGenerator";
import { camelCase, pascalCase } from "../naming";

type MakeControllerInput = { container: string; name: string; force?: boolean };

export class MakeControllerCommand extends ConsoleCommand<MakeControllerInput> {
	readonly signature =
		"thalys:make:controller {container : Container name} {name : Controller function name} {--f|force : Overwrite existing file}";
	readonly description = "Create a new controller function for a Container";

	handle(input: MakeControllerInput, _context: ConsoleContext): void {
		const generator = new FileGenerator(process.cwd());
		const entityName = pascalCase(input.name);
		const container = pascalCase(input.container);
		const lowerName = camelCase(input.name);
		const fnName = `${lowerName}${entityName}`;

		const path = generator.generate({
			outputPath: `src/Containers/${container}/UI/API/Controllers/${fnName}.ts`,
			stubName: "controller.stub",
			stubSubdir: "controllers",
			replacements: { Container: container, EntityName: entityName, lowerName },
			force: input.force,
		});

		_context.log.info({ path }, `Created ${fnName}`);
	}
}
