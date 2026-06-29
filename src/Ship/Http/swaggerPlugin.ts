import { swagger } from "@elysiajs/swagger";
import { Elysia } from "elysia";

const enabled = process.env.NODE_ENV !== "production" || process.env.ENABLE_SWAGGER === "true";

/**
 * OpenAPI 3.1 documentation plugin.
 * Serves Swagger UI at /docs.
 * Disabled in production — set ENABLE_SWAGGER=true to force-enable.
 */
export const swaggerPlugin = enabled
	? swagger({
			path: "/docs",
			documentation: {
				info: {
					title: "Thalys API",
					version: "1.0.0",
					description: "Auto-generated API documentation from TypeBox route schemas.",
				},
				components: {
					securitySchemes: {
						bearerAuth: {
							type: "http",
							scheme: "bearer",
							bearerFormat: "JWT",
						},
					},
				},
			},
			exclude: ["/docs", "/docs/json"],
		})
	: new Elysia({ name: "swagger:off" });
