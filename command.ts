import { createConsoleContext } from "./src/Ship/Console/ConsoleContext";
import { ConsoleKernel } from "./src/Ship/Console/ConsoleKernel";
import { commands } from "./src/Ship/Console/commands";

const context = createConsoleContext();
const kernel = new ConsoleKernel(context);

try {
	kernel.register(commands);
	await kernel.run(Bun.argv);
} finally {
	await context.close();
}
