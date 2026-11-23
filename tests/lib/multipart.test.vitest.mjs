/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /tests/lib/multipart.test.vitest.mjs
 *	@Date: 2026-11-22T12:00:00-08:00 (1795464000)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-11-22T12:00:00-08:00 (1795464000)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

import { describe, expect, test } from "vitest";
import { parse } from "../../src/lib/multipart.mjs";

const TYPE = "multipart/form-data; boundary=XyZ";
const body = (...parts) => Buffer.concat([...parts.map((part) => Buffer.from(`--XyZ\r\n${part}\r\n`)), Buffer.from("--XyZ--\r\n")]);
const file = (name, filename, type, content) =>
	`Content-Disposition: form-data; name="${name}"; filename="${filename}"\r\n${type ? `Content-Type: ${type}\r\n` : ""}\r\n${content}`;

describe("multipart parse", () => {
	test("reads text fields and file parts, binary safe", () => {
		const bytes = Buffer.from([0, 255, 13, 10, 45, 45, 88, 1]);
		const raw = Buffer.concat([
			Buffer.from('--XyZ\r\nContent-Disposition: form-data; name="purpose"\r\n\r\nuser_data\r\n'),
			Buffer.from(
				'--XyZ\r\nContent-Disposition: form-data; name="file"; filename="a.bin"\r\nnot a header line\r\nContent-Type: application/octet-stream\r\n\r\n'
			),
			bytes,
			Buffer.from("\r\n--XyZ--\r\n")
		]);
		const out = parse(raw, TYPE);
		expect(out.fields).toEqual({ purpose: "user_data" });
		expect(out.files).toHaveLength(1);
		expect(out.files[0]).toMatchObject({ name: "file", filename: "a.bin", type: "application/octet-stream" });
		expect(out.files[0].data.equals(bytes)).toBe(true);
	});

	test("a quoted or bare boundary, an escaped quote in a file name, and a part without a content type", () => {
		const out = parse(
			body(file("file", 'we"ird.txt', undefined, "x").replace('we"ird', 'we\\"ird')),
			'multipart/form-data; boundary="XyZ"'
		);
		expect(out.files[0]).toMatchObject({ filename: 'we"ird.txt', type: undefined });
		expect(parse(body(file("file", "a.txt", "text/plain", "x")), "multipart/form-data; boundary=XyZ; charset=utf-8").files).toHaveLength(1);
	});

	test("an empty body of parts is fine", () => {
		expect(parse(Buffer.from("--XyZ--\r\n"), TYPE)).toEqual({ fields: {}, files: [] });
	});

	test.each([
		["no content type", Buffer.from("--XyZ--"), undefined],
		["no boundary", Buffer.from("--XyZ--"), "multipart/form-data"],
		["an empty boundary", Buffer.from("--XyZ--"), 'multipart/form-data; boundary=""'],
		["no delimiter in the body", Buffer.from("hello"), TYPE],
		["a delimiter not followed by a line break", Buffer.from("--XyZx"), TYPE],
		["a truncated delimiter", Buffer.from("--XyZ"), TYPE],
		["a part that is never closed", Buffer.from('--XyZ\r\nContent-Disposition: form-data; name="a"\r\n\r\nx'), TYPE],
		["a part without a header block", Buffer.from("--XyZ\r\nabc\r\n--XyZ--"), TYPE],
		["a part without a name", Buffer.from("--XyZ\r\nContent-Type: text/plain\r\n\r\nx\r\n--XyZ--"), TYPE]
	])("%s is a 400 invalid_multipart", (_name, raw, type) => {
		expect(() => parse(raw, type)).toThrow(expect.objectContaining({ status: 400, code: "invalid_multipart" }));
	});
});
