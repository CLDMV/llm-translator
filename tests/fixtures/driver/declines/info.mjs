/**
 * @fileoverview Test driver that names a host in `info().hosts` but whose `detect` declines it.
 * @module @cldmv/llm-translator/test/driver/declines
 */

/**
 * Describe the driver.
 * @returns {{name: string, protocol: string, order: number, auth: string, hosts: string[], paths: Record<string,string>}} Driver facts.
 */
export function info() {
	return {
		name: "declines",
		protocol: "openai.chat",
		order: 5,
		auth: "bearer",
		hosts: ["decline.test"],
		paths: { chat: "/v1/chat/completions" }
	};
}
