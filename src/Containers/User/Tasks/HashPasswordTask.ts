export class HashPasswordTask {
	static async run(password: string): Promise<string> {
		return await Bun.password.hash(password, {
			algorithm: "bcrypt",
			cost: 12,
		});
	}
}
