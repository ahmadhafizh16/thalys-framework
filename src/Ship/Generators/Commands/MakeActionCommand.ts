import { ConsoleCommand } from "@ship/Console/ConsoleCommand";
import type { ConsoleContext } from "@ship/Console/ConsoleContext";
import { FileGenerator } from "../FileGenerator";
import { pascalCase } from "../naming";

type MakeActionInput = { container: string; name: string; force?: boolean };

export class MakeActionCommand extends ConsoleCommand<MakeActionInput> {
	readonly signature =
		"thalys:make:action {container : Container name} {name : Action name} {--f|force : Overwrite existing file}";
	readonly description = "Create a new Action class for a Container";

	handle(input: MakeActionInput, context: ConsoleContext): void {
		const generator = new FileGenerator(process.cwd());
		const actionName = pascalCase(input.name) + "Action";
		const container = pascalCase(input.container);

		const path = generator.generate({
			outputPath: `src/Containers/${container}/Actions/${actionName}.ts`,
			stubName: "action.stub",
			stubSubdir: "actions",
			replacements: { ActionName: actionName },
			force: input.force,
		});

		// Auto-register in registerServices.ts
		const importLine = `import { ${actionName} } from "@containers/${container}/Actions/${actionName}";`;
		const bindLine = `\tcontainer.bind(${actionName}, "db");`;

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

		context.log.info({ path, registered: true }, `Created ${actionName}`);
	}
}
