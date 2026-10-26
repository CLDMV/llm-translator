/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /tools/e2e/fake-vllm.mjs
 *	@Date: 2026-10-26T06:00:29-07:00 (1793019629)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-10-26T15:39:12-07:00 (1793054352)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

/**
 * @fileoverview A scripted vLLM-like upstream for debugging the harness and the translator without a model. It answers the
 * startup probes, replays Read/Write tool calls for the Claude Code scenarios and otherwise says hello.
 *
 * Environment: `FAKE_PORT` (default 8102), `FAKE_DELAY_MS` (delay before every chat answer, used to reproduce the stream
 * watchdog), `E2E_DIR` (see paths.mjs).
 */
import http from "node:http";
import { work } from "./paths.mjs";

const port = Number(process.env.FAKE_PORT ?? 8102);
const model = "qwen3-1.7b";

/**
 * Write a list of Chat Completions chunks as an SSE reply.
 * @param {http.ServerResponse} res - Response.
 * @param {(object|string)[]} chunks - Chunk objects or the literal `[DONE]`.
 * @returns {void}
 */
function sse(res, chunks) {
	res.writeHead(200, { "content-type": "text/event-stream" });
	for (const chunk of chunks) res.write(`data: ${typeof chunk === "string" ? chunk : JSON.stringify(chunk)}\n\n`);
	res.end();
}

/**
 * One streamed chunk.
 * @param {object} delta - Choice delta.
 * @param {string|null} [finish] - Finish reason.
 * @returns {object} Chunk.
 */
const chunk = (delta, finish = null) => ({
	id: "chatcmpl-fake",
	object: "chat.completion.chunk",
	model,
	choices: [{ index: 0, delta, finish_reason: finish }]
});

/**
 * Answer with a single tool call.
 * @param {http.ServerResponse} res - Response.
 * @param {string} name - Tool name.
 * @param {object} args - Tool arguments.
 * @returns {void}
 */
function call(res, name, args) {
	sse(res, [
		chunk({ role: "assistant", content: "" }),
		chunk({ reasoning: `I should use ${name}.` }),
		chunk({ tool_calls: [{ index: 0, id: `chatcmpl-tool-${name}`, type: "function", function: { name, arguments: "" } }] }),
		chunk({ tool_calls: [{ index: 0, function: { arguments: JSON.stringify(args) } }] }),
		chunk({}, "tool_calls"),
		"[DONE]"
	]);
}

http
	.createServer((req, res) => {
		const parts = [];
		req.on("data", (part) => parts.push(part));
		req.on("end", async () => {
			const json = (body, status = 200) => {
				res.writeHead(status, { "content-type": "application/json" });
				res.end(JSON.stringify(body));
			};
			if (req.url === "/version") return json({ version: "0.32.0" });
			if (req.url === "/v1/models") {
				return json({ object: "list", data: [{ id: model, object: "model", owned_by: "vllm", max_model_len: 32768 }] });
			}
			if (req.url === "/tokenize") {
				return json({ error: { message: "System message must be at the beginning.", type: "BadRequestError", code: 400 } }, 400);
			}
			if (process.env.FAKE_DELAY_MS) await new Promise((resolve) => setTimeout(resolve, Number(process.env.FAKE_DELAY_MS)));
			const body = JSON.parse(Buffer.concat(parts).toString() || "{}");
			const messages = body.messages ?? [];
			const tools = (body.tools ?? []).map((tool) => tool.function.name);
			const user = JSON.stringify(messages.filter((message) => message.role === "user").at(-1) ?? "");
			const lastTool = messages.findLastIndex((message) => message.role === "tool");
			const lastUser = messages.findLastIndex((message) => message.role === "user" && !JSON.stringify(message).includes("system-reminder"));
			if (lastTool > lastUser) {
				const content = messages[lastTool].content;
				const said = typeof content === "string" ? content : JSON.stringify(content);
				return sse(res, [
					chunk({ role: "assistant", content: "" }),
					chunk({ reasoning: "Reading the tool output." }),
					chunk({ content: `TOOL SAID: ${said.slice(0, 400)}` }),
					chunk({}, "stop"),
					"[DONE]"
				]);
			}
			if (tools.includes("Read") && user.includes("sample.pdf")) return call(res, "Read", { file_path: `${work}/sample.pdf` });
			if (tools.includes("Read") && user.includes("notes.txt")) return call(res, "Read", { file_path: `${work}/notes.txt` });
			if (tools.includes("Write") && user.includes("hello.txt")) {
				return call(res, "Write", { file_path: `${work}/hello.txt`, content: "hi" });
			}
			sse(res, [chunk({ role: "assistant", content: "" }), chunk({ content: "Hello from the fake." }), chunk({}, "stop"), "[DONE]"]);
		});
	})
	.listen(port, "127.0.0.1");
