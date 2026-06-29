import { ConsoleCommand } from "@ship/Console/ConsoleCommand";
import type { ConsoleContext } from "@ship/Console/ConsoleContext";
import { FileGenerator } from "../FileGenerator";
import { kebabCase, pascalCase, pluralize, snakeCase } from "../naming";

type MakeModelInput = { container: string; name: string; force?: boolean };

export class MakeModelCommand extends ConsoleCommand<MakeModelInput> {
	readonly signature =
		"thalys:make:model {container : Container name} {name : Model name} {--f|force : Overwrite existing file}";
	readonly description = "Create a new Drizzle schema and Repository for a Container";

	handle(input: MakeModelInput, _context: ConsoleContext): void {
		const generator = new FileGenerator(process.cwd());
		const entityName = pascalCase(input.name);
		const tableName = entityName.charAt(0).toLowerCase() + entityName.slice(1) + "sTable";
		const dbTableName = pluralize(snakeCase(input.name));
		const container = pascalCase(input.container);

		// Schema file
		const schemaPath = generator.generate({
			outputPath: `src/Containers/${container}/Models/${kebabCase(input.name)}.schema.ts`,
			stubName: "schema.stub",
			stubSubdir: "models",
			replacements: { tableName, dbTableName, EntityName: entityName },
			force: input.force,
		});

		// Repository file
		const repositoryName = entityName + "Repository";
		const schemaFile = kebabCase(input.name) + ".schema";
		const repoPath = generator.generate({
			outputPath: `src/Containers/${container}/Models/${repositoryName}.ts`,
			stubName: "repository.stub",
			stubSubdir: "repositories",
			replacements: { RepositoryName: repositoryName, tableName, schemaFile, Container: container },
			force: input.force,
		});

		_context.log.info({ schemaPath, repoPath }, `Created ${entityName} schema + repository`);
	}
}
