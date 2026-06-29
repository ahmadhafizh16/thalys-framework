import { ConsoleCommand } from "@ship/Console/ConsoleCommand";
import type { ConsoleContext } from "@ship/Console/ConsoleContext";
import { FileGenerator } from "../FileGenerator";
import { pascalCase } from "../naming";

type MakeTransformerInput = { container: string; name: string; force?: boolean };

export class MakeTransformerCommand extends ConsoleCommand<MakeTransformerInput> {
	readonly signature =
		"thalys:make:transformer {container : Container name} {name : Entity name} {--f|force : Overwrite existing file}";
	readonly description = "Create a new Transformer class for a Container";

	handle(input: MakeTransformerInput, _context: ConsoleContext): void {
		const generator = new FileGenerator(process.cwd());
		const transformerName = pascalCase(input.name) + "Transformer";
		const outputName = "Safe" + pascalCase(input.name) + "Output";
		const container = pascalCase(input.container);

		const path = generator.generate({
			outputPath: `src/Containers/${container}/Transformers/${transformerName}.ts`,
			stubName: "transformer.stub",
			stubSubdir: "transformers",
			replacements: { TransformerName: transformerName, OutputName: outputName },
			force: input.force,
		});

		_context.log.info({ path }, `Created ${transformerName}`);
	}
}
