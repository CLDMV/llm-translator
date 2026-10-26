/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /tests/cjs/entry.test.cjs
 *	@Date: 2026-10-24T20:25:14-07:00 (1792898714)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-10-25T12:59:03-07:00 (1792958343)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

/**
 * @fileoverview Checks the built dist/ output end to end: the ESM entry and the CJS shim expose the same exports, and a
 * translator composed from `dist/api` (slothlet scans it at runtime) converts, routes and serves. Run after
 * `npm run build` (see `test:dist`).
 */
"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { pathToFileURL } = require("node:url");

const root = path.resolve(__dirname, "../..");
const dist = path.join(root, "dist");

/**
 * A fetch-compatible transport answering like a tiny vLLM.
 * @param {string} url - Request URL.
 * @param {object} init - Request init.
 * @returns {Promise<Response>} Fake response.
 */
async function transport(url, init = {}) {
	const body = init.body ? JSON.parse(init.body) : {};
	if (body.stream) {
		const chunk = (delta, finish) =>
			`data: ${JSON.stringify({ id: "c1", object: "chat.completion.chunk", model: "m", choices: [{ index: 0, delta, finish_reason: finish ?? null }] })}\n\n`;
		const text = chunk({ role: "assistant", content: "" }) + chunk({ content: "dist ok" }) + chunk({}, "stop") + "data: [DONE]\n\n";
		return new Response(text, { status: 200, headers: { "content-type": "text/event-stream" } });
	}
	return new Response(
		JSON.stringify({
			id: "c1",
			object: "chat.completion",
			model: "m",
			choices: [{ index: 0, message: { role: "assistant", content: "dist ok" }, finish_reason: "stop" }],
			usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 }
		}),
		{ status: 200, headers: { "content-type": "application/json" } }
	);
}

test("CJS shim re-exports the ESM entry", async () => {
	const esm = await import(pathToFileURL(path.join(dist, "index.mjs")).href);
	const cjs = require(path.join(dist, "index.cjs"));
	// require(esm) adds an `__esModule` marker next to a default export.
	const names = Object.keys(cjs)
		.filter((key) => key !== "__esModule")
		.sort();
	assert.deepEqual(names, ["TranslatorError", "createTranslator", "default"]);
	assert.deepEqual(names, Object.keys(esm).sort());
	assert.equal(cjs.createTranslator, esm.createTranslator);
});

test("dist/index.mjs imports the root devcheck.mjs instead of bundling it", () => {
	const bundle = fs.readFileSync(path.join(dist, "index.mjs"), "utf8");
	assert.match(bundle, /import\(\s*["']\.\.\/devcheck\.mjs["']\s*\)/);
	assert.doesNotMatch(bundle, /Development environment not properly configured/);
});

test("dist mirrors the api folder slothlet scans", () => {
	for (const file of [
		"api/request.mjs",
		"api/server/start.mjs",
		"api/driver/vllm/detect.mjs",
		"api/convert/anthropic/messages/to/openai/chat/request.mjs",
		"lib/settings.mjs",
		"bin/llm-translator.mjs"
	]) {
		assert.ok(fs.existsSync(path.join(dist, file)), `${file} is missing from dist`);
	}
});

test("a translator composed from dist/api converts, streams and serves", async () => {
	const { createTranslator } = require(path.join(dist, "index.cjs"));
	const api = await createTranslator({ upstreams: [{ url: "http://vllm.test", backend: "vllm" }], detect: false, silent: true, transport });
	try {
		assert.deepEqual(Object.keys(api.driver).sort(), ["anthropic", "compatible", "openai", "vllm"]);
		assert.equal(api.status().upstreams[0].driver, "vllm");

		const body = { model: "m", max_tokens: 16, messages: [{ role: "user", content: "hi" }] };
		const reply = await api.send(body);
		assert.equal(reply.status, 200);
		assert.equal(reply.body.content[0].text, "dist ok");

		const streamed = await api.send({ ...body, stream: true });
		const names = [];
		for await (const event of streamed.stream) names.push(event.event);
		assert.equal(names[0], "message_start");
		assert.equal(names.at(-1), "message_stop");

		const server = await api.server.start({ port: 0 });
		try {
			const res = await fetch(`${server.url}/v1/messages`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(body)
			});
			assert.equal(res.status, 200);
			assert.equal((await res.json()).content[0].text, "dist ok");
		} finally {
			await api.server.stop();
		}
	} finally {
		await api.slothlet.shutdown();
	}
});

test("the built CLI runs", () => {
	const run = (flag) =>
		spawnSync(process.execPath, ["--conditions=llm-translator-dev", path.join(dist, "bin/llm-translator.mjs"), flag], { encoding: "utf8" });
	const help = run("--help");
	assert.equal(help.status, 0);
	assert.match(help.stdout, /Usage: llm-translator/);
	const version = run("--version");
	assert.equal(version.status, 0);
	assert.equal(version.stdout.trim(), require(path.join(root, "package.json")).version);
});
