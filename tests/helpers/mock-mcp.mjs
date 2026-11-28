/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /tests/helpers/mock-mcp.mjs
 *	@Date: 2026-11-28T12:00:00-08:00 (1795896000)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-11-28T12:00:00-08:00 (1795896000)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

/**
 * @fileoverview An in-process MCP server (Streamable HTTP, JSON-RPC) on a loopback port, for the tests of the `mcp` tool. It never leaves the machine.
 */
import http from "node:http";

/**
 * Start a mock MCP server.
 * @param {object} [options] - Behaviour.
 * @param {any[]} [options.tools] - The tools it lists (`{ name, description, inputSchema, annotations }`).
 * @param {number} [options.pageSize] - List this many tools per page, with `nextCursor`.
 * @param {boolean} [options.sse] - Answer requests as a Server-Sent Events stream.
 * @param {string} [options.session] - The `Mcp-Session-Id` it hands out.
 * @param {number} [options.listStatus] - Answer `tools/list` with this HTTP status.
 * @param {string} [options.rpcError] - Answer `tools/call` with a JSON-RPC error carrying this message.
 * @param {number} [options.redirect] - Answer `initialize` with a redirect of this status.
 * @param {string} [options.big] - Answer `tools/call` with this much text repeated, to exceed a size limit.
 * @param {boolean} [options.silent] - Answer `tools/call` with a message that has another id.
 * @param {(name: string, args: any) => any} [options.call] - Result of a call (`{ content, isError }`); default echoes the arguments.
 * @returns {Promise<{url: string, host: string, requests: any[], close: () => Promise<void>}>} The server.
 */
export async function mockMcp(options = {}) {
	const requests = [];
	const tools = options.tools ?? [
		{
			name: "search",
			description: "Search the docs",
			inputSchema: { type: "object", properties: { q: { type: "string" } }, required: ["q"] },
			annotations: { readOnlyHint: true }
		},
		{ name: "delete", description: "Delete a page", inputSchema: { type: "object", properties: { id: { type: "string" } } } }
	];
	const server = http.createServer(async (req, res) => {
		const chunks = [];
		for await (const chunk of req) chunks.push(chunk);
		const text = Buffer.concat(chunks).toString("utf8");
		const body = text === "" ? null : JSON.parse(text);
		requests.push({ method: req.method, headers: req.headers, body });
		if (req.method === "DELETE") {
			res.writeHead(204);
			return res.end();
		}
		if (body.id === undefined) {
			res.writeHead(202);
			return res.end();
		}
		const reply = (result, error, status = 200, extra = {}) => {
			const message = {
				jsonrpc: "2.0",
				id: options.silent && body.method === "tools/call" ? 999 : body.id,
				...(error ? { error } : { result })
			};
			if (options.sse) {
				res.writeHead(status, { "content-type": "text/event-stream", ...extra });
				return res.end(
					`event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", method: "notifications/progress", params: {} })}\n\ndata: ${JSON.stringify(message)}\n\n`
				);
			}
			res.writeHead(status, { "content-type": "application/json", ...extra });
			return res.end(JSON.stringify(message));
		};
		if (body.method === "initialize") {
			if (options.redirect) {
				res.writeHead(options.redirect, { location: "http://127.0.0.1:1/elsewhere" });
				return res.end();
			}
			return reply(
				{ protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "mock", version: "1" } },
				undefined,
				200,
				options.session ? { "mcp-session-id": options.session } : {}
			);
		}
		if (body.method === "tools/list") {
			if (options.listStatus) {
				res.writeHead(options.listStatus);
				return res.end("nope");
			}
			const size = options.pageSize ?? tools.length;
			const start = body.params?.cursor === undefined ? 0 : Number(body.params.cursor);
			return reply({
				tools: tools.slice(start, start + size),
				...(start + size < tools.length ? { nextCursor: String(start + size) } : {})
			});
		}
		if (body.method === "tools/call") {
			if (options.rpcError) return reply(undefined, { code: -32000, message: options.rpcError });
			if (options.big) return reply({ content: [{ type: "text", text: options.big.repeat(2000) }] });
			return reply(
				options.call
					? options.call(body.params.name, body.params.arguments)
					: { content: [{ type: "text", text: `called ${body.params.name} ${JSON.stringify(body.params.arguments)}` }] }
			);
		}
		return reply(undefined, { code: -32601, message: "method not found" });
	});
	await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
	const port = server.address().port;
	return {
		url: `http://127.0.0.1:${port}/mcp`,
		host: "127.0.0.1",
		requests,
		close: () =>
			new Promise((resolve) => {
				server.closeAllConnections();
				server.close(resolve);
			})
	};
}
