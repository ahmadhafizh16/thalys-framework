import type { AppDB } from "@ship/database/connection";
import { Container } from "./Container";

// Cache
import { InMemoryCacheStore } from "@ship/Cache/InMemoryCacheStore";
import { RedisCacheStore } from "@ship/Cache/RedisCacheStore";

// Queue
import { InMemoryQueueDriver } from "@ship/Queue/InMemoryQueueDriver";
import { RedisQueueDriver } from "@ship/Queue/RedisQueueDriver";

// Rate limiting
import { InMemoryRateLimitStore } from "@ship/Http/InMemoryRateLimitStore";
import { RedisRateLimitStore } from "@ship/Http/RedisRateLimitStore";

// Observability
import { ConsoleErrorReporter } from "@ship/Observability/ErrorReporter";
import type { ErrorReporter } from "@ship/Observability/ErrorReporter";

import { GetUserPermissionsTask } from "@containers/Auth/Tasks/GetUserPermissionsTask";
import { LoginTask } from "@containers/Auth/Tasks/LoginTask";
import { LogoutTask } from "@containers/Auth/Tasks/LogoutTask";
import { RegisterTask } from "@containers/Auth/Tasks/RegisterTask";
import { ValidateTokenTask } from "@containers/Auth/Tasks/ValidateTokenTask";
// Auth — Better Auth instance + Tasks
import { auth } from "@containers/Auth/betterAuth.config";

import { ListRolesAction } from "@containers/Auth/Actions/ListRolesAction";
// Auth — Actions
import { LoginAction } from "@containers/Auth/Actions/LoginAction";
import { LogoutAction } from "@containers/Auth/Actions/LogoutAction";
import { RegisterAction } from "@containers/Auth/Actions/RegisterAction";
import { ValidateTokenAction } from "@containers/Auth/Actions/ValidateTokenAction";

// Auth — Bridge
import { InProcessAuthBridgeAdapter } from "@containers/AuthBridge/Adapters/InProcessAuthBridgeAdapter";

// Roles — Bridge
import { InProcessRolesBridgeAdapter } from "@containers/RolesBridge/Adapters/InProcessRolesBridgeAdapter";

// User container
import { CreateUserAction } from "@containers/User/Actions/CreateUserAction";
import { DeleteUserAction } from "@containers/User/Actions/DeleteUserAction";
import { UpdateUserAction } from "@containers/User/Actions/UpdateUserAction";
import { UserRepository } from "@containers/User/Models/UserRepository";
import { HashPasswordTask } from "@containers/User/Tasks/HashPasswordTask";

// Events
import { EventDispatcher } from "@ship/Events/EventDispatcher";
// {{GENERATOR_IMPORTS}}

export function createContainer(db: AppDB): Container {
	const container = new Container();
	container.set("db", db);

	// Observability — error reporter (default: console, swap for Sentry/Loki)
	container.set<ErrorReporter>("ErrorReporter", new ConsoleErrorReporter());

	// Events — in-process pub/sub
	const eventDispatcher = new EventDispatcher();
	container.set("eventDispatcher", eventDispatcher);

	// Cache — Redis if REDIS_URL is set, otherwise in-memory
	const cache = process.env.REDIS_URL
		? new RedisCacheStore(process.env.REDIS_URL)
		: new InMemoryCacheStore();
	container.set("cache", cache);

	// Queue — Redis if REDIS_URL is set, otherwise in-memory
	const queue = process.env.REDIS_URL
		? new RedisQueueDriver(process.env.REDIS_URL)
		: new InMemoryQueueDriver();
	container.set("queue", queue);

	// Rate limiting — Redis if REDIS_URL is set, otherwise in-memory
	const rateLimitStore = process.env.REDIS_URL
		? new RedisRateLimitStore(process.env.REDIS_URL)
		: new InMemoryRateLimitStore();
	container.set("rateLimitStore", rateLimitStore);

	// Auth — Better Auth instance (raw singleton)
	container.set("authInstance", auth);

	// Auth Tasks (string dep resolves from instances map)
	container.bind(LoginTask, "authInstance");
	container.bind(RegisterTask, "authInstance");
	container.bind(ValidateTokenTask, "authInstance");
	container.bind(LogoutTask, "authInstance");
	container.bind(GetUserPermissionsTask, "db");

	// Auth Actions
	container.bind(LoginAction, "db", LoginTask);
	container.bind(RegisterAction, "db", RegisterTask);
	container.bind(ValidateTokenAction, "db", ValidateTokenTask);
	container.bind(LogoutAction, "db", LogoutTask);
	container.bind(ListRolesAction, "db");

	// Auth Bridge — exposes validateToken + logout to Ship middleware
	container.bind(
		InProcessAuthBridgeAdapter,
		ValidateTokenAction,
		LogoutAction,
		GetUserPermissionsTask,
	);
	container.set("AuthBridgePort", container.make(InProcessAuthBridgeAdapter));

	// Roles Bridge — exposes role lookups to User container (seeder)
	container.bind(InProcessRolesBridgeAdapter, ListRolesAction);
	container.set("RolesBridgePort", container.make(InProcessRolesBridgeAdapter));

	// Repositories
	container.bind(UserRepository, "db");

	// Pure utility tasks (no DB dependency)
	container.bind(HashPasswordTask);

	// User Actions
	container.bind(CreateUserAction, "db", UserRepository, HashPasswordTask);
	container.bind(UpdateUserAction, "db", UserRepository);
	container.bind(DeleteUserAction, "db", UserRepository);

	// {{GENERATOR_BINDINGS}}

	// Register event listeners (explicit, NOT auto-discovery)
	// {{GENERATOR_LISTENERS}}
	return container;
}
