export abstract class BaseTransformer<TInput, TOutput> {
	abstract transform(input: TInput): TOutput;
}
