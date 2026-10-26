export async function request() {
	await new Promise((resolve) => setTimeout(resolve, 120));
	throw new Error("late crash");
}
