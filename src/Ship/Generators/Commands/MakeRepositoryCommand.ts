import { ConsoleCommand } from "@ship/Console/ConsoleCommand";
import type { ConsoleContext } from "@ship/Console/ConsoleContext";
import { FileGenerator } from "../FileGenerator";
import { kebabCase, pascalCase } from "../naming";

type MakeRepositoryInput = { container: string; name: string; force?: boolean };

export class MakeRepositoryCommand extends ConsoleCommand<MakeRepositoryInput> {
	readonly signature =
		"thalys:make:repository {container : Container name} {name : Entity name} {--f|force : Overwrite existing file}";
	readonly description = "Create a new Repository class for a Container";

	handle(input: MakeRepositoryInput, context: ConsoleContext): void {
		const generator = new FileGenerator(process.cwd());
		const entityName = pascalCase(input.name);
		const repositoryName = entityName + "Repository";
		const tableName = entityName.charAt(0).toLowerCase() + entityName.slice(1) + "sTable";
		const schemaFile = kebabCase(input.name) + ".schema";
		const container = pascalCase(input.container);

		const path = generator.generate({
			outputPath: `src/Containers/${container}/Models/${repositoryName}.ts`,
			stubName: "repository.stub",
			stubSubdir: "repositories",
			replacements: { RepositoryName: repositoryName, tableName, schemaFile, Container: container },
			force: input.force,
		});

		// Auto-register in registerServices.ts
		const importLine = `import { ${repositoryName} } from "@containers/${container}/Models/${repositoryName}";`;
		const bindLine = `\tcontainer.bind(${repositoryName}, "db");`;

		generator.insertIntoFile(
			"src/Ship/Container/registerServices.ts",
			"// {{GENERATOR_IMPORTS}}",
			importLine,
		);
		generator.insertIntoFile(
			"src/Ship/Container/registerServices.ts",
			"// {{GENERATOR_BINDINGS}}",
			bindLine,
		);

		context.log.info({ path, registered: true }, `Created ${repositoryName}`);
	}
}
