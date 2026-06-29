import { db } from "@ship/database/connection";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { bearer } from "better-auth/plugins";

import { accountsTable } from "@containers/Auth/Models/account.schema";
import { sessionsTable } from "@containers/Auth/Models/session.schema";
import { verificationsTable } from "@containers/Auth/Models/verification.schema";
import { usersTable } from "@containers/User/Models/user.schema";

const schema = {
	users: usersTable,
	sessions: sessionsTable,
	accounts: accountsTable,
	verifications: verificationsTable,
};

export const auth = betterAuth({
	baseURL: process.env.APP_URL ?? "http://localhost:3000",
	database: drizzleAdapter(db, { provider: "pg", schema, usePlural: true }),
	emailAndPassword: {
		enabled: true,
	},
	plugins: [bearer()],
	socialProviders: {
		google: process.env.GOOGLE_CLIENT_ID
			? {
					clientId: process.env.GOOGLE_CLIENT_ID,
					clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
				}
			: undefined,
		github: process.env.GITHUB_CLIENT_ID
			? {
					clientId: process.env.GITHUB_CLIENT_ID,
					clientSecret: process.env.GITHUB_CLIENT_SECRET!,
				}
			: undefined,
	},
	session: {
		expiresIn: 60 * 60 * 24 * 7, // 7 days
		updateAge: 60 * 60 * 24, // refresh every day
	},
});
