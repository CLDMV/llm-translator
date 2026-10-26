export function info() {
	return { name: "latecrash", protocol: "openai.chat", order: 1, auth: "bearer", paths: { chat: "/v1/chat/completions" } };
}
