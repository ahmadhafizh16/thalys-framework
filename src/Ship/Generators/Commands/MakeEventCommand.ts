import { ConsoleCommand } from "@ship/Console/ConsoleCommand";
import type { ConsoleContext } from "@ship/Console/ConsoleContext";
import { FileGenerator } from "../FileGenerator";
import { kebabCase, pascalCase } from "../naming";

type MakeEventInput = { container: string; name: string; force?: boolean };

export class MakeEventCommand extends ConsoleCommand<MakeEventInput> {
	readonly signature =
		"thalys:make:event {container : Container name} {name : Event name} {--f|force : Overwrite existing file}";
	readonly description = "Create a new event class for a Container";

	handle(input: MakeEventInput, context: ConsoleContext): void {
		const generator = new FileGenerator(process.cwd());
		const container = pascalCase(input.container);
		const eventName = pascalCase(input.name) + "Event";
		const channel = `${kebabCase(input.container)}.${kebabCase(input.name)}`;

		const path = generator.generate({
			outputPath: `src/Containers/${container}/Events/${eventName}.ts`,
			stubName: "event.stub",
			stubSubdir: "events",
			replacements: {
				EventName: eventName,
				channel,
			},
			force: input.force,
		});

		context.log.info({ path }, `Created ${eventName}`);
	}
}
