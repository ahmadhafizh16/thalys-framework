import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { ConsoleCommand } from "@ship/Console/ConsoleCommand";
import type { ConsoleContext } from "@ship/Console/ConsoleContext";
import { FileGenerator } from "../FileGenerator";
import { camelCase, kebabCase, pascalCase, pluralize } from "../naming";

type MakeContainerInput = { name: string; crud?: boolean; force?: boolean };

const DIRS = ["Actions", "Tasks", "Models", "Transformers", "Requests", "UI/API/v1", "UI/Command"];

export class MakeContainerCommand extends ConsoleCommand<MakeContainerInput> {
	readonly signature =
		"thalys:make:container {name : Container name} {--crud : Scaffold full CRUD (model, repository, actions, transformer, requests, routes)} {--f|force : Overwrite existing files}";
	readonly description = "Scaffold a full Container skeleton with all directories";

	handle(input: MakeContainerInput, context: ConsoleContext): void {
		const generator = new FileGenerator(process.cwd());
		const container = pascalCase(input.name);
		const baseDir = join(process.cwd(), "src/Containers", container);

		if (existsSync(baseDir) && !input.force) {
			throw new Error(
				`Container already exists: src/Containers/${container}. Use --force to overwrite.`,
			);
		}

		for (const dir of DIRS) {
			mkdirSync(join(baseDir, dir), { recursive: true });
		}

		const lowerName = camelCase(input.name);
		const pluralLower = pluralize(kebabCase(input.name));
		const entityName = container;
		const tableName = `${lowerName}sTable`;
		const dbTableName = pluralLower.replace(/-/g, "_");
		const schemaFile = `${kebabCase(input.name)}.schema`;
		const repositoryName = `${entityName}Repository`;
		const transformerName = `${entityName}Transformer`;
		const outputName = `Safe${entityName}Output`;

		const replacements = {
			Container: container,
			lowerName,
			pluralLower,
			EntityName: entityName,
			tableName,
			dbTableName,
			schemaFile,
			RepositoryName: repositoryName,
			TransformerName: transformerName,
			OutputName: outputName,
		};

		const generatedFiles: string[] = [];

		if (input.crud) {
			// Schema
			generatedFiles.push(
				generator.generate({
					outputPath: `src/Containers/${container}/Models/${schemaFile}.ts`,
					stubName: "schema.stub",
					stubSubdir: "models",
					replacements,
					force: input.force,
				}),
			);

			// Repository
			generatedFiles.push(
				generator.generate({
					outputPath: `src/Containers/${container}/Models/${repositoryName}.ts`,
					stubName: "repository.stub",
					stubSubdir: "repositories",
					replacements,
					force: input.force,
				}),
			);

			// Requests
			generatedFiles.push(
				generator.generate({
					outputPath: `src/Containers/${container}/Requests/${schemaFile}.ts`,
					stubName: "request-crud.stub",
					stubSubdir: "requests",
					replacements,
					force: input.force,
				}),
			);
			generatedFiles.push(
				generator.generate({
					outputPath: `src/Containers/${container}/Requests/list-${pluralLower}.request.ts`,
					stubName: "list-crud.stub",
					stubSubdir: "requests",
					replacements,
					force: input.force,
				}),
			);

			// Actions
			for (const op of ["create", "update", "delete"] as const) {
				generatedFiles.push(
					generator.generate({
						outputPath: `src/Containers/${container}/Actions/${pascalCase(op)}${entityName}Action.ts`,
						stubName: `action-${op}.stub`,
						stubSubdir: "actions",
						replacements,
						force: input.force,
					}),
				);
			}

			// Transformer
			generatedFiles.push(
				generator.generate({
					outputPath: `src/Containers/${container}/Transformers/${transformerName}.ts`,
					stubName: "transformer.stub",
					stubSubdir: "transformers",
					replacements,
					force: input.force,
				}),
			);

			// Controllers (per-file functions)
			const controllerOps = [
				{ op: "create", stub: "controller-create.stub" },
				{ op: "list", stub: "controller-list.stub" },
				{ op: "detail", stub: "controller-detail.stub" },
				{ op: "update", stub: "controller-update.stub" },
				{ op: "delete", stub: "controller-delete.stub" },
			] as const;
			for (const { op, stub } of controllerOps) {
				const fnName =
					op === "detail" ? `get${entityName}` : `${op}${entityName}${op === "list" ? "s" : ""}`;
				generatedFiles.push(
					generator.generate({
						outputPath: `src/Containers/${container}/UI/API/Controllers/${fnName}.ts`,
						stubName: stub,
						stubSubdir: "controllers",
						replacements,
						force: input.force,
					}),
				);
			}

			// Routes (CRUD)
			generatedFiles.push(
				generator.generate({
					outputPath: `src/Containers/${container}/UI/API/v1/routes.ts`,
					stubName: "routes-crud.stub",
					stubSubdir: "container",
					replacements,
					force: input.force,
				}),
			);

			// Auto-register in registerServices.ts
			const imports = [
				`import { Create${entityName}Action } from "@containers/${container}/Actions/Create${entityName}Action";`,
				`import { Update${entityName}Action } from "@containers/${container}/Actions/Update${entityName}Action";`,
				`import { Delete${entityName}Action } from "@containers/${container}/Actions/Delete${entityName}Action";`,
				`import { ${repositoryName} } from "@containers/${container}/Models/${repositoryName}";`,
			];
			const binds = [
				`\tcontainer.bind(${repositoryName}, "db");`,
				`\tcontainer.bind(Create${entityName}Action, "db", ${repositoryName});`,
				`\tcontainer.bind(Update${entityName}Action, "db", ${repositoryName});`,
				`\tcontainer.bind(Delete${entityName}Action, "db", ${repositoryName});`,
			];

			for (const line of imports) {
				generator.insertIntoFile(
					"src/Ship/Container/registerServices.ts",
					"// {{GENERATOR_IMPORTS}}",
					line,
				);
			}
			for (const line of binds) {
				generator.insertIntoFile(
					"src/Ship/Container/registerServices.ts",
					"// {{GENERATOR_BINDINGS}}",
					line,
				);
			}
		} else {
			// Bare skeleton — just routes
			generatedFiles.push(
				generator.generate({
					outputPath: `src/Containers/${container}/UI/API/v1/routes.ts`,
					stubName: "routes.stub",
					stubSubdir: "container",
					replacements,
					force: input.force,
				}),
			);
		}

		// Auto-register routes in index.ts (both modes)
		const routeVar = `${lowerName}RoutesV1`;
		const importLine = `import { ${routeVar} } from "./Containers/${container}/UI/API/v1/routes";`;
		const mountLine = `\t.use(${routeVar})`;

		generator.insertIntoFile("src/index.ts", "// {{GENERATOR_ROUTE_IMPORTS}}", importLine);
		generator.insertIntoFile("src/index.ts", "// {{GENERATOR_ROUTE_MOUNTS}}", mountLine);

		context.log.info(
			{
				container: `src/Containers/${container}`,
				files: generatedFiles.length,
				crud: input.crud ?? false,
				registered: true,
			},
			`Scaffolded ${container} container${input.crud ? " with full CRUD" : ""}`,
		);
	}
}
