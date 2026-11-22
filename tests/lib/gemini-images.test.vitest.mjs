/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /tests/lib/gemini-images.test.vitest.mjs
 *	@Date: 2026-11-22T10:00:00-08:00 (1795370400)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-11-22T10:00:00-08:00 (1795370400)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

/**
 * @fileoverview GIF images for Gemini: a base64 GIF becomes a PNG, a GIF at a URL is fetched only when documentUrls is on, and anything that cannot be had is left as it is.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { prepare } from "../../src/lib/gemini-images.mjs";
import * as pdf from "../../src/lib/pdf.mjs";
import { FetchError } from "../../src/lib/fetch-url.mjs";

/** A 1x1 GIF. */
const GIF = "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
const options = { allow: ["img.example.com"], maxBytes: 1000000, timeout: 1000, maxRedirects: 0, maxDocuments: 5, allowPrivate: false };
const events = [];
const spec = (extra = {}) => ({ options: null, report: (event) => events.push(event), ...extra });
const body = (...parts) => ({ model: "m", messages: [{ role: "user", content: parts }] });
const image = (url) => ({ type: "image_url", image_url: { url } });

beforeAll(async () => {
	await pdf.load();
});

describe("prepare", () => {
	it("turns a base64 GIF into a PNG data URL of its first frame, and leaves the rest as it was", async () => {
		const input = body({ type: "text", text: "see" }, image(`data:image/gif;base64,${GIF}`), image("data:image/png;base64,AAAA"));
		const out = await prepare(input, spec());
		expect(out).not.toBe(input);
		expect(out.messages[0].content[0]).toBe(input.messages[0].content[0]);
		expect(out.messages[0].content[1].image_url.url).toMatch(/^data:image\/png;base64,iVBOR/);
		expect(out.messages[0].content[2]).toBe(input.messages[0].content[2]);
		expect(input.messages[0].content[1].image_url.url).toContain("image/gif");
	});

	it("takes the string form of image_url too, and returns the same body when there is nothing to do", async () => {
		const out = await prepare(body({ type: "image_url", image_url: `data:image/gif;base64,${GIF}` }), spec());
		expect(out.messages[0].content[0].image_url.url).toMatch(/^data:image\/png/);
		const plain = {
			model: "m",
			messages: [
				{ role: "user", content: "hi" },
				{ role: "user", content: [image("data:image/png;base64,AAAA")] }
			]
		};
		expect(await prepare(plain, spec())).toBe(plain);
		expect(await prepare({ model: "m" }, spec())).toEqual({ model: "m" });
		expect(await prepare(null, spec())).toBeNull();
	});

	it("leaves a GIF that cannot be decoded, and does nothing without the canvas library", async () => {
		const broken = body(image("data:image/gif;base64,AAAA"));
		expect(await prepare(broken, spec())).toBe(broken);
		const real = pdf.canvasModule();
		await pdf.load(async (name) => {
			if (name === "@napi-rs/canvas") throw new Error("no canvas");
			return import(name);
		});
		try {
			const input = body(image(`data:image/gif;base64,${GIF}`));
			expect(await prepare(input, spec())).toBe(input);
		} finally {
			await pdf.load();
			expect(pdf.canvasModule()).not.toBeNull();
			expect(real).not.toBeNull();
		}
	});

	it("fetches a GIF at a URL only when documentUrls is on, with the GIF content type, and says so", async () => {
		const url = "https://img.example.com/a.gif?sig=1";
		const calls = [];
		const fetch = async (target, used) => {
			calls.push([target, used.types.get("image/gif"), used.allow]);
			return { bytes: Buffer.from(GIF, "base64"), mediaType: "image/gif", url: target };
		};
		const off = body(image(url));
		expect(await prepare(off, spec({ fetch }))).toBe(off);
		expect(calls).toEqual([]);
		events.length = 0;
		const out = await prepare(off, spec({ options, fetch }));
		expect(out.messages[0].content[0].image_url.url).toMatch(/^data:image\/png/);
		expect(calls).toEqual([[url, "image/gif", ["img.example.com"]]]);
		expect(events[0]).toMatchObject({ kind: "fetched", url: "https://img.example.com/a.gif" });
		const png = body(image("https://img.example.com/a.png"));
		expect(await prepare(png, spec({ options, fetch }))).toBe(png);
	});

	it("works without a report function, and leaves an image part that has no url", async () => {
		const fetch = async () => ({ bytes: Buffer.from(GIF, "base64"), mediaType: "image/gif", url: "x" });
		const got = await prepare(body(image("https://img.example.com/a.gif")), { options, fetch });
		expect(got.messages[0].content[0].image_url.url).toMatch(/^data:image\/png/);
		const refused = async () => {
			throw new Error("down");
		};
		const rejected = body(image("https://img.example.com/a.gif"));
		expect(await prepare(rejected, { options, fetch: () => Promise.reject("plain") })).toBe(rejected);
		const kept = body(image("https://img.example.com/a.gif"));
		expect(await prepare(kept, { options, fetch: refused })).toBe(kept);
		const bare = body({ type: "image_url" }, { type: "image_url", image_url: null });
		expect(await prepare(bare, spec({ options }))).toBe(bare);
	});

	it("keeps a GIF URL that could not be fetched, with a warning that names no query", async () => {
		const url = "https://img.example.com/a.gif?token=secret";
		events.length = 0;
		const refused = async () => {
			throw new FetchError("allow", "the host is not on the allow list", "host img.example.com");
		};
		const input = body(image(url));
		expect(await prepare(input, spec({ options, fetch: refused }))).toBe(input);
		expect(events[0]).toMatchObject({ kind: "fetch", level: "warn", reason: "allow", url: "https://img.example.com/a.gif" });
		expect(events[0].message).not.toContain("secret");
		const odd = async () => {
			throw new Error("boom");
		};
		expect(await prepare(input, spec({ options, fetch: odd }))).toBe(input);
		expect(events[1]).toMatchObject({ reason: "network" });
		const notGif = async () => ({ bytes: Buffer.from("AAAA"), mediaType: "image/gif", url });
		expect(await prepare(input, spec({ options, fetch: notGif }))).toBe(input);
	});
});
