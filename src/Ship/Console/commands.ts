import { SeedRolesCommand } from "@containers/Auth/UI/Command/SeedRolesCommand";
import { SeedUsersCommand } from "@containers/User/UI/Command/SeedUsersCommand";
import { WorkCommand } from "@ship/Queue/WorkCommand";
import {
	MigrateGenerateCommand,
	MigrateRunCommand,
	MigrateStatusCommand,
} from "./Command/MigrateCommand";
import { TruncateTableCommand } from "./Command/TruncateTableCommand";
import type { ConsoleCommand } from "./ConsoleCommand";
// {{GENERATOR_IMPORTS}}

// Generator commands
import { MakeActionCommand } from "@ship/Generators/Commands/MakeActionCommand";
import { MakeCommandCommand } from "@ship/Generators/Commands/MakeCommandCommand";
import { MakeContainerCommand } from "@ship/Generators/Commands/MakeContainerCommand";
import { MakeControllerCommand } from "@ship/Generators/Commands/MakeControllerCommand";
import { MakeEventCommand } from "@ship/Generators/Commands/MakeEventCommand";
import { MakeFactoryCommand } from "@ship/Generators/Commands/MakeFactoryCommand";
import { MakeListenerCommand } from "@ship/Generators/Commands/MakeListenerCommand";
import { MakeMiddlewareCommand } from "@ship/Generators/Commands/MakeMiddlewareCommand";
import { MakeModelCommand } from "@ship/Generators/Commands/MakeModelCommand";
import { MakeRepositoryCommand } from "@ship/Generators/Commands/MakeRepositoryCommand";
import { MakeRequestCommand } from "@ship/Generators/Commands/MakeRequestCommand";
import { MakeTaskCommand } from "@ship/Generators/Commands/MakeTaskCommand";
import { MakeTestCommand } from "@ship/Generators/Commands/MakeTestCommand";
import { MakeTransformerCommand } from "@ship/Generators/Commands/MakeTransformerCommand";

export const commands: readonly ConsoleCommand[] = [
	// Application commands
	new SeedRolesCommand(),
	new SeedUsersCommand(),
	new TruncateTableCommand(),
	new MigrateGenerateCommand(),
	new MigrateRunCommand(),
	new MigrateStatusCommand(),
	new WorkCommand(),
	// {{GENERATOR_COMMANDS}}

	// Generator commands
	new MakeActionCommand(),
	new MakeCommandCommand(),
	new MakeContainerCommand(),
	new MakeControllerCommand(),
	new MakeEventCommand(),
	new MakeListenerCommand(),
	new MakeMiddlewareCommand(),
	new MakeModelCommand(),
	new MakeRepositoryCommand(),
	new MakeRequestCommand(),
	new MakeTaskCommand(),
	new MakeTransformerCommand(),
	new MakeFactoryCommand(),
	new MakeTestCommand(),
];
