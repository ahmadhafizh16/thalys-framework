import { commands } from "./src/Ship/Console/commands";
import { createConsoleContext } from "./src/Ship/Console/ConsoleContext";
import { ConsoleKernel } from "./src/Ship/Console/ConsoleKernel";

const context = createConsoleContext();
const kernel = new ConsoleKernel(context);

kernel.register(commands);
await kernel.run(Bun.argv);
