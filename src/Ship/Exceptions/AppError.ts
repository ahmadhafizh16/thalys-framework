export class AppError extends Error {
	constructor(
		public statusCode: number,
		public code: string,
		message: string,
	) {
		super(message);
		this.name = this.constructor.name;
		Object.setPrototypeOf(this, new.target.prototype);
	}
}

export class NotFoundError extends AppError {
	constructor(resource: string) {
		super(404, "NOT_FOUND", `${resource} could not be located.`);
	}
}

export class ConflictError extends AppError {
	constructor(message: string) {
		super(409, "CONFLICT_OCCURRED", message);
	}
}
