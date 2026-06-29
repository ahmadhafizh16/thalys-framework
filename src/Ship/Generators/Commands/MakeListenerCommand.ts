import { ConsoleCommand } from "@ship/Console/ConsoleCommand";
import type { ConsoleContext } from "@ship/Console/ConsoleContext";
import { FileGenerator } from "../FileGenerator";
import { kebabCase, pascalCase } from "../naming";

type MakeListenerInput = { container: string; name: string; force?: boolean };

export class MakeListenerCommand extends ConsoleCommand<MakeListenerInput> {
	readonly signature =
		"thalys:make:listener {container : Container name} {name : Listener name} {--f|force : Overwrite existing file}";
	readonly description = "Create a new event listener class for a Container";

	handle(input: MakeListenerInput, context: ConsoleContext): void {
		const generator = new FileGenerator(process.cwd());
		const container = pascalCase(input.container);
		const listenerName = pascalCase(input.name) + "Listener";
		const channel = `${kebabCase(input.container)}.${kebabCase(input.name)}`;

		const path = generator.generate({
			outputPath: `src/Containers/${container}/Listeners/${listenerName}.ts`,
			stubName: "listener.stub",
			stubSubdir: "events",
			replacements: {
				ListenerName: listenerName,
				channel,
			},
			force: input.force,
		});

		// Auto-register: import + register listener with EventDispatcher
		const importLine = `import { ${listenerName} } from "@containers/${container}/Listeners/${listenerName}";`;
		const registerLine = `\teventDispatcher.on(new ${listenerName}());`;

		generator.insertIntoFile(
			"src/Ship/Container/registerServices.ts",
			"// {{GENERATOR_IMPORTS}}",
			importLine,
		);
		generator.insertIntoFile(
			"src/Ship/Container/registerServices.ts",
			"// {{GENERATOR_LISTENERS}}",
			registerLine,
		);

		context.log.info({ path, registered: true }, `Created ${listenerName}`);
	}
}
