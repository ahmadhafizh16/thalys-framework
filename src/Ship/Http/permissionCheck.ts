export function hasPermission(
	userPermissions: { resource: string; action: string }[],
	required: { resource: string; action: string },
): boolean {
	return userPermissions.some((p) => {
		if (p.resource === required.resource && p.action === required.action) return true;
		if (p.resource === "*" && p.action === required.action) return true;
		if (p.resource === required.resource && p.action === "*") return true;
		if (p.resource === "*" && p.action === "*") return true;
		return false;
	});
}
