import { defineConfig } from "drizzle-kit";

export default defineConfig({
	dialect: "postgresql",
	schema: "./src/Containers/**/Models/*.schema.ts",
	out: "./drizzle",
	dbCredentials: {
		url: process.env.APP_DATABASE_URL ?? "postgres://localhost:30001/appdb",
	},
	verbose: true,
	strict: true,
});
