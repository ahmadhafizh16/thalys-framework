import { ConsoleCommand } from "@ship/Console/ConsoleCommand";
import type { ConsoleContext } from "@ship/Console/ConsoleContext";
import { FileGenerator } from "../FileGenerator";
import { pascalCase } from "../naming";

type MakeTaskInput = { container: string; name: string; pure?: boolean; force?: boolean };

export class MakeTaskCommand extends ConsoleCommand<MakeTaskInput> {
	readonly signature =
		"thalys:make:task {container : Container name} {name : Task name} {--pure : Skip DB base class} {--f|force : Overwrite existing file}";
	readonly description = "Create a new Task class for a Container";

	handle(input: MakeTaskInput, context: ConsoleContext): void {
		const generator = new FileGenerator(process.cwd());
		const taskName = pascalCase(input.name) + "Task";
		const container = pascalCase(input.container);

		const path = generator.generate({
			outputPath: `src/Containers/${container}/Tasks/${taskName}.ts`,
			stubName: input.pure ? "task-pure.stub" : "task.stub",
			stubSubdir: "tasks",
			replacements: { TaskName: taskName },
			force: input.force,
		});

		// Auto-register in registerServices.ts
		const importLine = `import { ${taskName} } from "@containers/${container}/Tasks/${taskName}";`;
		const dep = input.pure ? "" : ', "db"';
		const bindLine = `\tcontainer.bind(${taskName}${dep});`;

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

		context.log.info({ path, registered: true }, `Created ${taskName}`);
	}
}
