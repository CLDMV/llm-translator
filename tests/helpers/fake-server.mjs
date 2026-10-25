/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /tests/helpers/fake-server.mjs
 *	@Date: 2026-10-25T12:18:21-07:00 (1792955901)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-10-25T12:59:04-07:00 (1792958344)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

/**
 * @fileoverview Local node:http fakes for upstream servers (vLLM-like and Anthropic-like). Never touches the internet.
 */
import http from "node:http";

/**
 * Read a request body as parsed JSON (or the raw text when it is not JSON).
 * @param {http.IncomingMessage} req - Request.
 * @returns {Promise<any>} Body.
 */
async function readBody(req) {
	const chunks = [];
	for await (const chunk of req) chunks.push(chunk);
	const text = Buffer.concat(chunks).toString("utf8");
	try {
		return JSON.parse(text);
	} catch {
		return text;
	}
}

/**
 * Send a JSON reply.
 * @param {http.ServerResponse} res - Response.
 * @param {number} status - Status.
 * @param {any} body - Body.
 * @param {Record<string,string>} [headers] - Extra headers.
 * @returns {void}
 */
export function json(res, status, body, headers = {}) {
	res.writeHead(status, { "content-type": "application/json", ...headers });
	res.end(JSON.stringify(body));
}

/**
 * Write SSE `data:` frames to a response, optionally stalling between frames.
 * @param {http.ServerResponse} res - Response.
 * @param {any[]} frames - Objects (JSON-encoded) or strings (written as is).
 * @param {object} [options] - `{ delay }` ms before every frame, `{ stallFirst }` ms before the first frame.
 * @returns {Promise<void>} Resolves when all frames were written (or the client left).
 */
export async function sse(res, frames, options = {}) {
	res.writeHead(200, { "content-type": "text/event-stream" });
	let first = true;
	for (const frame of frames) {
		const wait = first ? (options.stallFirst ?? options.delay ?? 0) : (options.delay ?? 0);
		first = false;
		if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
		if (res.destroyed) return;
		res.write(`data: ${typeof frame === "string" ? frame : JSON.stringify(frame)}\n\n`);
	}
	res.end();
}

/**
 * Standard vLLM streaming chunks for a text answer.
 * @param {string[]} parts - Content pieces.
 * @param {object} [options] - `{ reasoning: string[], finish }`.
 * @returns {any[]} Frames ending with the usage chunk and `[DONE]`.
 */
export function textChunks(parts, options = {}) {
	const base = { id: "chatcmpl-1", object: "chat.completion.chunk", created: 1, model: "qwen3-coder" };
	const frames = [{ ...base, choices: [{ index: 0, delta: { role: "assistant", content: "" }, finish_reason: null }] }];
	for (const text of options.reasoning ?? []) {
		frames.push({ ...base, choices: [{ index: 0, delta: { reasoning: text }, finish_reason: null }] });
	}
	for (const text of parts) frames.push({ ...base, choices: [{ index: 0, delta: { content: text }, finish_reason: null }] });
	frames.push({ ...base, choices: [{ index: 0, delta: {}, finish_reason: options.finish ?? "stop" }] });
	frames.push({ ...base, choices: [], usage: { prompt_tokens: 12, completion_tokens: parts.length + 1, total_tokens: 20 } });
	frames.push("[DONE]");
	return frames;
}

/**
 * A completed non-streaming Chat Completions body.
 * @param {string} text - Assistant text.
 * @returns {object} Chat completion.
 */
export function completion(text) {
	return {
		id: "chatcmpl-1",
		object: "chat.completion",
		created: 1,
		model: "qwen3-coder",
		choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" }],
		usage: { prompt_tokens: 12, completion_tokens: 4, total_tokens: 16 }
	};
}

/**
 * Start a fake vLLM-like server.
 * @param {object} [options] - `{ version, models, ownedBy, tokenizeRejectsInlineSystem, chat }`. `version: null` removes `/version`.
 * `chat(req, body, res, record)` handles `/v1/chat/completions` (default: an answer in the requested mode).
 * @returns {Promise<{url: string, requests: object[], close: () => Promise<void>, options: object}>} Server handle.
 */
export async function fakeVllm(options = {}) {
	const settings = {
		version: "0.19.0",
		models: ["qwen3-coder"],
		ownedBy: "vllm",
		maxModelLen: 32768,
		tokenizeRejectsInlineSystem: false,
		...options
	};
	const requests = [];
	const server = http.createServer(async (req, res) => {
		const body = req.method === "POST" ? await readBody(req) : undefined;
		const record = { method: req.method, url: req.url, headers: req.headers, body };
		requests.push(record);
		if (settings.handler && (await settings.handler(req, body, res, record)) === true) return;
		if (req.method === "GET" && req.url === "/version") {
			return settings.version === null ? json(res, 404, { detail: "Not Found" }) : json(res, 200, { version: settings.version });
		}
		if (req.method === "GET" && req.url === "/v1/models") {
			return json(res, 200, {
				object: "list",
				data: settings.models.map((id) => ({
					id,
					object: "model",
					created: 1700000000,
					owned_by: settings.ownedBy,
					max_model_len: settings.maxModelLen
				}))
			});
		}
		if (req.method === "POST" && req.url === "/tokenize") {
			const roles = (body.messages ?? []).map((message) => message.role);
			if (settings.tokenizeRejectsInlineSystem && roles.lastIndexOf("system") > 0) {
				return json(res, 400, { error: { message: "System message must be at the beginning.", type: "BadRequestError", code: 400 } });
			}
			return json(res, 200, { count: 42, max_model_len: settings.maxModelLen, tokens: [] });
		}
		if (req.method === "POST" && req.url === "/v1/chat/completions") {
			if (settings.chat) return settings.chat(req, body, res, record);
			return body.stream ? sse(res, textChunks(["Hello", " world"])) : json(res, 200, completion("Hello world"));
		}
		return json(res, 404, { error: { message: "Not Found", type: "NotFoundError", code: 404 } });
	});
	await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
	return {
		url: `http://127.0.0.1:${server.address().port}`,
		requests,
		options: settings,
		close: () =>
			new Promise((resolve) => {
				server.closeAllConnections();
				server.close(resolve);
			})
	};
}
