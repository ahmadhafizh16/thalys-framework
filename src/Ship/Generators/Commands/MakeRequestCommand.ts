import { ConsoleCommand } from "@ship/Console/ConsoleCommand";
import type { ConsoleContext } from "@ship/Console/ConsoleContext";
import { FileGenerator } from "../FileGenerator";
import { kebabCase, pascalCase } from "../naming";

type MakeRequestInput = { container: string; name: string; force?: boolean };

export class MakeRequestCommand extends ConsoleCommand<MakeRequestInput> {
	readonly signature =
		"thalys:make:request {container : Container name} {name : Request name} {--f|force : Overwrite existing file}";
	readonly description = "Create a new Request schema with TypeBox for a Container";

	handle(input: MakeRequestInput, _context: ConsoleContext): void {
		const generator = new FileGenerator(process.cwd());
		const requestName = pascalCase(input.name) + "Request";
		const dtoName = pascalCase(input.name) + "DTO";
		const container = pascalCase(input.container);

		const path = generator.generate({
			outputPath: `src/Containers/${container}/Requests/${kebabCase(input.name)}.request.ts`,
			stubName: "request.stub",
			stubSubdir: "requests",
			replacements: { RequestName: requestName, DTOName: dtoName },
			force: input.force,
		});

		_context.log.info({ path }, `Created ${requestName}`);
	}
}
