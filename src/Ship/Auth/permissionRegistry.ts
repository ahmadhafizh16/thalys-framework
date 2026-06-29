export interface PermissionDefinition {
	resource: string;
	action: string;
	description: string;
}

export const PERMISSIONS: readonly PermissionDefinition[] = [
	{ resource: "user", action: "create", description: "Create new users" },
	{ resource: "user", action: "read", description: "View user profiles" },
	{ resource: "user", action: "update", description: "Edit user profiles" },
	{ resource: "user", action: "delete", description: "Delete users" },
	{ resource: "product", action: "create", description: "Create products" },
	{ resource: "product", action: "read", description: "View products" },
	{ resource: "product", action: "update", description: "Edit products" },
	{ resource: "order", action: "read", description: "View orders" },
	{ resource: "order", action: "update", description: "Update order status" },
];
