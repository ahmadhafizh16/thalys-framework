import { ConsoleCommand } from "@ship/Console/ConsoleCommand";
import type { ConsoleContext } from "@ship/Console/ConsoleContext";
import { FileGenerator } from "../FileGenerator";
import { kebabCase, pascalCase } from "../naming";

type MakeFactoryInput = { container: string; name: string; force?: boolean };

export class MakeFactoryCommand extends ConsoleCommand<MakeFactoryInput> {
	readonly signature =
		"thalys:make:factory {container : Container name} {name : Entity name} {--f|force : Overwrite existing file}";
	readonly description = "Create a new factory for generating test/seed data";

	handle(input: MakeFactoryInput, _context: ConsoleContext): void {
		const generator = new FileGenerator(process.cwd());
		const container = pascalCase(input.container);
		const entityName = pascalCase(input.name);
		const factoryName = `${entityName}Factory`;
		const schemaFile = `${kebabCase(input.name)}.schema`;

		const factoryPath = generator.generate({
			outputPath: `src/Containers/${container}/Factories/${factoryName}.ts`,
			stubName: "factory.stub",
			stubSubdir: "factories",
			replacements: {
				FactoryName: factoryName,
				EntityName: entityName,
				Container: container,
				schemaFile,
			},
			force: input.force,
		});

		_context.log.info({ factoryPath }, `Created ${factoryName}`);
	}
}
