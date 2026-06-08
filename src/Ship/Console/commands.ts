import type { ConsoleCommand } from "./ConsoleCommand";
import { TruncateTableCommand } from "./Command/TruncateTableCommand";
import { SeedRolesCommand } from "@containers/Role/UI/Command/SeedRolesCommand";
import { SeedUsersCommand } from "@containers/User/UI/Command/SeedUsersCommand";

export const commands: readonly ConsoleCommand[] = [
	new SeedRolesCommand(),
	new SeedUsersCommand(),
	new TruncateTableCommand(),
];
