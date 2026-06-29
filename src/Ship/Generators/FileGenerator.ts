import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export interface GenerateOptions {
	outputPath: string;
	stubName: string;
	stubSubdir?: string;
	replacements: Record<string, string>;
	force?: boolean;
}

export class FileGenerator {
	private readonly stubsDir: string;
	private readonly customStubsDir: string;
	private readonly projectRoot: string;

	constructor(projectRoot: string) {
		this.projectRoot = projectRoot;
		this.stubsDir = join(projectRoot, "src/Ship/Generators/Stubs");
		this.customStubsDir = join(projectRoot, "src/Ship/Generators/CustomStubs");
	}

	generate(options: GenerateOptions): string {
		const stubContent = this.readStub(options.stubName, options.stubSubdir);
		const filled = this.replace(stubContent, options.replacements);
		const fullPath = join(this.projectRoot, options.outputPath);

		mkdirSync(dirname(fullPath), { recursive: true });
		if (existsSync(fullPath) && !options.force) {
			throw new Error(`File already exists: ${options.outputPath}. Use --force to overwrite.`);
		}
		writeFileSync(fullPath, filled, "utf-8");
		return fullPath;
	}

	insertIntoFile(filePath: string, marker: string, lineToInsert: string): void {
		const content = readFileSync(filePath, "utf-8");
		if (content.includes(lineToInsert)) return;
		const updated = content.replace(marker, `${lineToInsert}\n${marker}`);
		writeFileSync(filePath, updated, "utf-8");
	}

	private readStub(name: string, subdir?: string): string {
		const relPath = subdir ? `${subdir}/${name}` : name;
		const customPath = join(this.customStubsDir, relPath);
		if (existsSync(customPath)) return readFileSync(customPath, "utf-8");

		const defaultPath = join(this.stubsDir, relPath);
		if (existsSync(defaultPath)) return readFileSync(defaultPath, "utf-8");

		throw new Error(`Stub not found: ${relPath} (checked CustomStubs/ and Stubs/)`);
	}

	private replace(content: string, replacements: Record<string, string>): string {
		let result = content;
		for (const [key, value] of Object.entries(replacements)) {
			result = result.replaceAll(`{{${key}}}`, value);
		}
		return result;
	}
}
