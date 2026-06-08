import type { RawUserEntity } from "../Models/user.schema";

export interface SafeUserOutput {
	id: string;
	fullName: string;
	emailAddress: string;
	phone: string | null;
	profilePic: string | null;
	roleId: number;
	registeredOn: string;
}

export class UserTransformer {
	static transform(user: RawUserEntity): SafeUserOutput {
		return {
			id: user.externalId,
			fullName: user.name,
			emailAddress: user.email,
			phone: user.phone,
			profilePic: user.profilePic,
			roleId: user.roleId,
			registeredOn: user.createdAt.toISOString(),
		};
	}
}
