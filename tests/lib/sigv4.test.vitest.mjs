/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /tests/lib/sigv4.test.vitest.mjs
 *	@Date: 2026-11-19T09:00:00-08:00 (1795107600)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-11-19T09:00:00-08:00 (1795107600)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

/**
 * @fileoverview SigV4 signing: AWS's published test-suite and documentation vectors, then the properties Amazon Bedrock calls rely on (a model id in the path is signed double-encoded, a session token is signed, the body hash covers the exact body).
 */
import { createHash, createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { sign, stamp } from "../../src/lib/sigv4.mjs";

// The credentials and time every AWS SigV4 example and test-suite vector uses.
const keys = { accessKeyId: "AKIDEXAMPLE", secretAccessKey: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY" };
const date = new Date("2015-08-30T12:36:00Z");
const suite = { ...keys, region: "us-east-1", service: "service", date };
const empty = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
const sha = (text) => createHash("sha256").update(text).digest("hex");

describe("sigv4 against AWS's published vectors", () => {
	it("get-vanilla (aws-sig-v4-test-suite): canonical request, string to sign and signature", () => {
		const out = sign({ ...suite, url: "https://example.amazonaws.com/" });
		expect(out.canonicalRequest).toBe(`GET\n/\n\nhost:example.amazonaws.com\nx-amz-date:20150830T123600Z\n\nhost;x-amz-date\n${empty}`);
		expect(out.stringToSign).toBe(
			"AWS4-HMAC-SHA256\n20150830T123600Z\n20150830/us-east-1/service/aws4_request\nbb579772317eb040ac9ed261061d46c1f17a8133879d6129b6e1c25292927e63"
		);
		expect(out.signature).toBe("5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31");
		expect(out.authorization).toBe(
			"AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, SignedHeaders=host;x-amz-date, Signature=5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31"
		);
		expect(out.signedHeaders).toBe("host;x-amz-date");
		expect(out.headers).toEqual({ "x-amz-date": "20150830T123600Z", authorization: out.authorization });
	});

	it("post-vanilla (aws-sig-v4-test-suite)", () => {
		const out = sign({ ...suite, method: "POST", url: "https://example.amazonaws.com/" });
		expect(out.signature).toBe("5da7c1a2acd57cee7505fc6676e4e544621c30862966e37dddb68e92efbe5d6b");
	});

	it("post-x-www-form-urlencoded (aws-sig-v4-test-suite): a signed header and a body", () => {
		const out = sign({
			...suite,
			method: "POST",
			url: "https://example.amazonaws.com/",
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
			body: "Param1=value1"
		});
		expect(out.signedHeaders).toBe("content-type;host;x-amz-date");
		expect(out.signature).toBe("ff11897932ad3f4e8b18135d722051e5ac45fc38421b1da7b9d196a0fe09473a");
	});

	it("get-vanilla-query-order-key-case (aws-sig-v4-test-suite): the query is sorted", () => {
		const out = sign({ ...suite, url: "https://example.amazonaws.com/?Param2=value2&Param1=value1" });
		expect(out.canonicalRequest.split("\n")[2]).toBe("Param1=value1&Param2=value2");
		expect(out.signature).toBe("b97d918cfa904a5beff61c982a1b6f458b799221646efd99d3219ec94cdf2500");
	});

	it("the IAM ListUsers example of the SigV4 documentation", () => {
		const out = sign({
			...keys,
			region: "us-east-1",
			service: "iam",
			date,
			url: "https://iam.amazonaws.com/?Action=ListUsers&Version=2010-05-08",
			headers: { "Content-Type": "application/x-www-form-urlencoded; charset=utf-8" }
		});
		expect(sha(out.canonicalRequest)).toBe("f536975d06c0309214f805bb90ccff089219ecd68b2577efef23edd43b7e1a59");
		expect(out.signature).toBe("5d672d79c15b13162d9279b0855cfba6789a8edb4c82c400e06b5924a6f2b5d7");
	});
});

describe("sigv4 properties", () => {
	const hmac = (key, data) => createHmac("sha256", key).update(data).digest();

	it("pins a Bedrock-style call derived step by step from the specification", () => {
		const body = JSON.stringify({ anthropic_version: "bedrock-2023-05-31", max_tokens: 16, messages: [{ role: "user", content: "hi" }] });
		const out = sign({
			...keys,
			region: "us-west-2",
			service: "bedrock",
			date,
			method: "POST",
			url: "https://bedrock-runtime.us-west-2.amazonaws.com/model/anthropic.claude-sonnet-4-5-20250929-v1%3A0/invoke",
			headers: { "content-type": "application/json", accept: "application/json" },
			body
		});
		// The canonical URI encodes the already encoded path once more: %3A on the wire is %253A in the signature.
		const canonical = [
			"POST",
			"/model/anthropic.claude-sonnet-4-5-20250929-v1%253A0/invoke",
			"",
			"accept:application/json\ncontent-type:application/json\nhost:bedrock-runtime.us-west-2.amazonaws.com\nx-amz-date:20150830T123600Z\n",
			"accept;content-type;host;x-amz-date",
			sha(body)
		].join("\n");
		expect(out.canonicalRequest).toBe(canonical);
		const toSign = `AWS4-HMAC-SHA256\n20150830T123600Z\n20150830/us-west-2/bedrock/aws4_request\n${sha(canonical)}`;
		expect(out.stringToSign).toBe(toSign);
		const key = hmac(hmac(hmac(hmac(`AWS4${keys.secretAccessKey}`, "20150830"), "us-west-2"), "bedrock"), "aws4_request");
		expect(out.signature).toBe(hmac(key, toSign).toString("hex"));
		expect(out.headers.authorization).toContain("Credential=AKIDEXAMPLE/20150830/us-west-2/bedrock/aws4_request");
		expect(out.headers.accept).toBe("application/json");
	});

	it("signs a session token as x-amz-security-token and returns it", () => {
		const out = sign({ ...suite, url: "https://example.amazonaws.com/", sessionToken: "TOKEN" });
		expect(out.signedHeaders).toBe("host;x-amz-date;x-amz-security-token");
		expect(out.headers["x-amz-security-token"]).toBe("TOKEN");
		expect(out.canonicalRequest).toContain("x-amz-security-token:TOKEN\n");
	});

	it("trims header values and collapses inner runs of spaces, and keeps the port in host", () => {
		const out = sign({ ...suite, url: "http://127.0.0.1:8123/", headers: { "X-Test": "  a   b \t c  " } });
		expect(out.canonicalRequest).toContain("host:127.0.0.1:8123\nx-amz-date:20150830T123600Z\nx-test:a b c\n");
	});

	it("sorts a query by name and then value, and encodes what SigV4 encodes", () => {
		const out = sign({ ...suite, url: "https://example.amazonaws.com/?b=2&a=2&a=1&c=(x)*" });
		expect(out.canonicalRequest.split("\n")[2]).toBe("a=1&a=2&b=2&c=%28x%29%2A");
	});

	it("covers the exact body: another body gives another signature", () => {
		const first = sign({ ...suite, method: "POST", url: "https://example.amazonaws.com/", body: "{}" });
		const second = sign({ ...suite, method: "POST", url: "https://example.amazonaws.com/", body: "{ }" });
		expect(first.signature).not.toBe(second.signature);
		expect(first.canonicalRequest.endsWith(sha("{}"))).toBe(true);
	});

	it("takes the time from the clock by default, and formats it like X-Amz-Date", () => {
		const out = sign({ ...keys, region: "us-east-1", service: "service", url: "https://example.amazonaws.com/" });
		expect(out.headers["x-amz-date"]).toMatch(/^\d{8}T\d{6}Z$/);
		expect(stamp(new Date("2026-11-19T09:05:07.123Z"))).toBe("20261119T090507Z");
	});
});
