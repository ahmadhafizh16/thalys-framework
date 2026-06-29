import type { RawUserEntity } from "@containers/User/Models/user.schema";
import { BaseTransformer } from "@ship/Transformers/BaseTransformer";

export interface SafeUserOutput {
	id: string;
	fullName: string;
	emailAddress: string;
	phone: string | null;
	profilePic: string | null;
	roleId: string | null;
	registeredOn: string;
}

export class UserTransformer extends BaseTransformer<RawUserEntity, SafeUserOutput> {
	transform(user: RawUserEntity): SafeUserOutput {
		return {
			id: user.id,
			fullName: user.name,
			emailAddress: user.email,
			phone: user.phone,
			profilePic: user.profilePic,
			roleId: user.roleId,
			registeredOn: user.createdAt.toISOString(),
		};
	}
}
