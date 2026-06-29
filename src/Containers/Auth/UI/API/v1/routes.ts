import { LoginRequest } from "@containers/Auth/Requests/login.request";
import { RegisterRequest } from "@containers/Auth/Requests/register.request";
import { login } from "@containers/Auth/UI/API/Controllers/login";
import { logout } from "@containers/Auth/UI/API/Controllers/logout";
import { register } from "@containers/Auth/UI/API/Controllers/register";
import type { Container } from "@ship/Container/Container";
import { routeGroup } from "@ship/Http/routeGroup";

export const authRoutesV1 = routeGroup("/v1/auth", "auth")
	.post("/register", async ({ container, body }) => register(body, container as Container), {
		body: RegisterRequest,
	})
	.post("/login", async ({ container, body }) => login(body, container as Container), {
		body: LoginRequest,
	})
	.post("/logout", async ({ request, container }) => logout(request, container as Container));
