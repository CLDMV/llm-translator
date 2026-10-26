import { TranslatorError } from "../../../../src/lib/errors.mjs";

export async function request() {
	await new Promise((resolve) => setTimeout(resolve, 120));
	throw new TranslatorError("late translator error", { code: "late", status: 400 });
}
