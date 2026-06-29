import { join } from "node:path";
import { ConsoleCommand } from "@ship/Console/ConsoleCommand";
import type { ConsoleContext } from "@ship/Console/ConsoleContext";
import { FileGenerator } from "../FileGenerator";
import { kebabCase, pascalCase } from "../naming";

type MakeCommandInput = { name: string; container?: string; force?: boolean };

export class MakeCommandCommand extends ConsoleCommand<MakeCommandInput> {
	readonly signature =
		"thalys:make:command {name : Command name} {--container= : Target container (optional)} {--f|force : Overwrite existing file}";
	readonly description = "Create a new Console Command and auto-register it";

	handle(input: MakeCommandInput, _context: ConsoleContext): void {
		const generator = new FileGenerator(process.cwd());
		const commandName = pascalCase(input.name) + "Command";
		const signature = kebabCase(input.name).replace(/-/g, ":");
		const description = `Run the ${commandName}`;

		const outputDir = input.container
			? `src/Containers/${pascalCase(input.container)}/UI/Command`
			: "src/Ship/Console/Command";

		const path = generator.generate({
			outputPath: `${outputDir}/${commandName}.ts`,
			stubName: "command.stub",
			stubSubdir: "commands",
			replacements: { CommandName: commandName, signature, description },
			force: input.force,
		});

		// Auto-register in commands.ts
		const commandsPath = join(process.cwd(), "src/Ship/Console/commands.ts");
		const importLine = `import { ${commandName} } from "./Command/${commandName}";`;
		const instanceLine = `\tnew ${commandName}(),`;

		if (!input.container) {
			generator.insertIntoFile(commandsPath, "// {{GENERATOR_IMPORTS}}", importLine);
			generator.insertIntoFile(commandsPath, "// {{GENERATOR_COMMANDS}}", instanceLine);
		}

		_context.log.info({ path }, `Created ${commandName}`);
	}
}
