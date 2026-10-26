/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /tests/api/image-fallback.test.vitest.mjs
 *	@Date: 2026-10-26T09:30:00-07:00 (1793032200)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-10-26T09:30:00-07:00 (1793032200)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

import { afterEach, describe, expect, it } from "vitest";
import { closeAll, collect, make } from "../helpers/translator.mjs";
import { completion, fakeVllm, json, sse, textChunks } from "../helpers/fake-server.mjs";
import { pdfBase64 } from "../helpers/pdf.mjs";
import { resolve } from "../../src/lib/settings.mjs";
import * as images from "../../src/lib/images.mjs";

afterEach(closeAll);

const REFUSAL = { error: { message: "qwen3-1.7b is not a multimodal model", type: "BadRequestError", code: 400 } };
const withImage = {
	model: "qwen3-coder",
	max_tokens: 64,
	messages: [
		{
			role: "user",
			content: [
				{ type: "text", text: "what is this" },
				{ type: "image", source: { type: "url", url: "https://x/y.png" } }
			]
		}
	]
};

/** A chat handler that refuses image requests with `message` (or the vLLM wording) and answers everything else. */
const picky = (message) => (_req, body, res) => {
	if (JSON.stringify(body).includes("image_url")) return json(res, 400, message ? { error: { message } } : REFUSAL);
	return body.stream ? sse(res, textChunks(["seen"])) : json(res, 200, completion("seen"));
};
const chats = (server) => server.requests.filter((entry) => entry.url === "/v1/chat/completions");

describe("recognising a refusal of image input", () => {
	it.each([
		"qwen3-1.7b is not a multimodal model",
		"At most 0 image(s) may be provided in one prompt.",
		"Invalid content type. image_url is only supported by certain models.",
		"Model does not support images. Please use a model that does.",
		"This model does not support image inputs",
		"image input is not supported - hint: provide the mmproj",
		"Images are not supported by this model"
	])("matches %j", (message) => expect(images.refused(message)).toBe(true));

	it.each(["Invalid image data URL", "The image is too large", "max_tokens must be positive", ""])("ignores %j", (message) =>
		expect(images.refused(message)).toBe(false)
	);
});

describe("Chat Completions body helpers", () => {
	it("finds and replaces image parts", () => {
		const body = {
			messages: [
				{ role: "system", content: "s" },
				{ role: "user", content: "plain" },
				{
					role: "user",
					content: [
						{ type: "text", text: "t" },
						{ type: "image_url", image_url: { url: "data:x" } }
					]
				}
			]
		};
		expect(images.carries(body)).toBe(true);
		const out = images.strip(body);
		expect(images.carries(out)).toBe(false);
		expect(out.messages[2].content).toEqual([
			{ type: "text", text: "t" },
			{ type: "text", text: images.NOTE }
		]);
		expect(out.messages[1]).toBe(body.messages[1]);
		expect(images.carries({})).toBe(false);
		expect(images.strip({}).messages).toEqual([]);
	});
});

describe("retrying without images", () => {
	it("retries a refused request once without images and remembers the model", async () => {
		const server = await fakeVllm({ chat: picky() });
		try {
			const api = await make({ upstreams: [{ url: server.url, settings: { images: true } }] });
			const first = await api.send(withImage);
			expect(first.status).toBe(200);
			expect(first.body.content[0].text).toBe("seen");
			expect(chats(server)).toHaveLength(2);
			expect(JSON.stringify(chats(server)[1].body)).toContain("does not accept images");
			const second = await api.send(withImage);
			expect(second.status).toBe(200);
			// The remembered model skips the failed attempt.
			expect(chats(server)).toHaveLength(3);
			expect(JSON.stringify(chats(server)[2].body)).not.toContain("image_url");
		} finally {
			await server.close();
		}
	});

	it("retries a streaming request", async () => {
		const server = await fakeVllm({ chat: picky("Model does not support images.") });
		try {
			const api = await make({ upstreams: [{ url: server.url, settings: { images: true } }] });
			const reply = await api.send({ ...withImage, stream: true });
			expect(reply.status).toBe(200);
			const events = await collect(reply.stream);
			expect(events.at(-1).event).toBe("message_stop");
			expect(chats(server)).toHaveLength(2);
		} finally {
			await server.close();
		}
	});

	it("drops PDF page images and keeps the text on the retry", async () => {
		const server = await fakeVllm({ chat: picky() });
		try {
			const api = await make({ upstreams: [{ url: server.url, settings: { images: true } }] });
			const reply = await api.send({
				...withImage,
				messages: [
					{
						role: "user",
						content: [{ type: "document", source: { type: "base64", media_type: "application/pdf", data: pdfBase64(["page one text"]) } }]
					}
				]
			});
			expect(reply.status).toBe(200);
			expect(chats(server)).toHaveLength(2);
			expect(JSON.stringify(chats(server)[0].body)).toContain("image_url");
			expect(JSON.stringify(chats(server)[1].body)).toContain("page one text");
			expect(JSON.stringify(chats(server)[1].body)).not.toContain("image_url");
		} finally {
			await server.close();
		}
	});

	it("retries an OpenAI-front request that was forwarded unchanged", async () => {
		const server = await fakeVllm({ chat: picky() });
		try {
			const api = await make({ upstreams: [{ url: server.url, settings: { images: true } }] });
			const body = {
				model: "qwen3-coder",
				messages: [
					{ role: "user", content: [{ type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } }] },
					{ role: "assistant", content: "ok" }
				]
			};
			const first = await api.send(body, { front: "openai" });
			expect(first.status).toBe(200);
			expect(chats(server)[1].body.messages[0].content).toEqual([{ type: "text", text: images.NOTE }]);
			await api.send(body, { front: "openai" });
			expect(chats(server)).toHaveLength(3);
		} finally {
			await server.close();
		}
	});

	it("does not retry other 400s", async () => {
		const server = await fakeVllm({ chat: picky("Invalid image data URL") });
		try {
			const api = await make({ upstreams: [{ url: server.url, settings: { images: true } }] });
			const reply = await api.send(withImage);
			expect(reply.status).toBe(400);
			expect(reply.body.error.message).toBe("Invalid image data URL");
			expect(chats(server)).toHaveLength(1);
		} finally {
			await server.close();
		}
	});

	it("does not retry when the request had no images", async () => {
		const server = await fakeVllm({ chat: (_req, _body, res) => json(res, 400, REFUSAL) });
		try {
			const api = await make({ upstreams: [{ url: server.url, settings: { images: true } }] });
			const reply = await api.send({ model: "qwen3-coder", max_tokens: 8, messages: [{ role: "user", content: "hi" }] });
			expect(reply.status).toBe(400);
			expect(chats(server)).toHaveLength(1);
		} finally {
			await server.close();
		}
	});

	it("does not retry when imageFallback is off", async () => {
		const server = await fakeVllm({ chat: picky() });
		try {
			const api = await make({ upstreams: [{ url: server.url, settings: { images: true, imageFallback: false } }] });
			const reply = await api.send(withImage);
			expect(reply.status).toBe(400);
			expect(chats(server)).toHaveLength(1);
			await api.send(withImage);
			expect(chats(server)).toHaveLength(2);
		} finally {
			await server.close();
		}
	});

	it("returns the error when the retry fails too", async () => {
		const server = await fakeVllm({ chat: (_req, _body, res) => json(res, 400, REFUSAL) });
		try {
			const api = await make({ upstreams: [{ url: server.url, settings: { images: true } }] });
			const reply = await api.send(withImage);
			expect(reply.status).toBe(400);
			expect(chats(server)).toHaveLength(2);
		} finally {
			await server.close();
		}
	});

	it("rejects an invalid imageFallback value", () => {
		expect(() => resolve({ imageFallback: "yes" })).toThrow(/imageFallback/);
		expect(resolve().imageFallback).toBe(true);
	});
});

describe("retrying without images through the server", () => {
	it("answers the client after the retry", async () => {
		const server = await fakeVllm({ chat: picky() });
		try {
			const api = await make({ upstreams: [{ url: server.url, settings: { images: true } }] });
			const running = await api.server.start({ port: 0 });
			const reply = await fetch(`${running.url}/v1/messages`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(withImage)
			});
			expect(reply.status).toBe(200);
			expect((await reply.json()).content[0].text).toBe("seen");
			expect(chats(server)).toHaveLength(2);
		} finally {
			await server.close();
		}
	});
});
