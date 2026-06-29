import { defineConfig } from "vitepress";

export default defineConfig({
	title: "Thalys",
	description: "Production-grade, enterprise-oriented framework for building type-safe APIs on Bun",
	lastUpdated: true,
	cleanUrls: true,
	themeConfig: {
		nav: [
			{ text: "Getting Started", link: "/getting-started/introduction" },
			{ text: "Architecture", link: "/architecture/overview" },
			{ text: "CLI Reference", link: "/cli/make-container" },
			{ text: "Guides", link: "/guides/auth-setup" },
		],
		sidebar: [
			{
				text: "Getting Started",
				items: [
					{ text: "Introduction", link: "/getting-started/introduction" },
					{ text: "Installation", link: "/getting-started/installation" },
					{ text: "Environment Setup", link: "/getting-started/environment" },
					{ text: "Your First Container", link: "/getting-started/first-container" },
				],
			},
			{
				text: "Architecture",
				items: [
					{ text: "Overview", link: "/architecture/overview" },
					{ text: "Ship vs Containers", link: "/architecture/ship-vs-containers" },
					{ text: "Bridge Pattern", link: "/architecture/bridge-pattern" },
					{ text: "Dependency Injection", link: "/architecture/dependency-injection" },
					{ text: "Porto Layers", link: "/architecture/porto-layers" },
					{ text: "Request Pipeline", link: "/architecture/request-pipeline" },
				],
			},
			{
				text: "CLI Reference",
				items: [
					{ text: "make:container", link: "/cli/make-container" },
					{ text: "make:action", link: "/cli/make-action" },
					{ text: "make:task", link: "/cli/make-task" },
					{ text: "make:repository", link: "/cli/make-repository" },
					{ text: "make:transformer", link: "/cli/make-transformer" },
					{ text: "make:request", link: "/cli/make-request" },
					{ text: "make:model", link: "/cli/make-model" },
					{ text: "make:factory", link: "/cli/make-factory" },
					{ text: "make:test", link: "/cli/make-test" },
					{ text: "make:event", link: "/cli/make-event" },
					{ text: "make:listener", link: "/cli/make-listener" },
					{ text: "make:middleware", link: "/cli/make-middleware" },
					{ text: "make:command", link: "/cli/make-command" },
					{ text: "make:controller", link: "/cli/make-controller" },
					{ text: "db:generate", link: "/cli/db-generate" },
					{ text: "db:migrate", link: "/cli/db-migrate" },
					{ text: "db:status", link: "/cli/db-status" },
					{ text: "db:seed:roles", link: "/cli/db-seed-roles" },
					{ text: "db:seed:users", link: "/cli/db-seed-users" },
					{ text: "db:truncate", link: "/cli/db-truncate" },
					{ text: "thalys:work", link: "/cli/thalys-work" },
				],
			},
			{
				text: "Guides",
				items: [
					{ text: "Auth Setup", link: "/guides/auth-setup" },
					{ text: "CRUD Scaffold", link: "/guides/crud-scaffold" },
					{ text: "Testing", link: "/guides/testing" },
					{ text: "Events", link: "/guides/events" },
					{ text: "RBAC & Permissions", link: "/guides/rbac" },
					{ text: "Cache & Queue", link: "/guides/cache-queue" },
					{ text: "Health & Metrics", link: "/guides/health-metrics" },
					{ text: "Localization", link: "/guides/localization" },
					{ text: "Deploying", link: "/guides/deploying" },
				],
			},
		],
		socialLinks: [{ icon: "github", link: "https://github.com/anomalyco/elysia" }],
		search: {
			provider: "local",
		},
		footer: {
			message: "Released under the MIT License.",
			copyright: "Copyright © 2026 Thalys",
		},
	},
});
