/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /tests/lib/bedrock.test.vitest.mjs
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
 * @fileoverview Amazon Bedrock runtime facts: Claude model ids, regions and URLs, model paths, and how a call is authenticated.
 */
import { describe, expect, it } from "vitest";
import { authenticate, claude, credential, defaultUrl, modelPath, regionOf, regionOfHost } from "../../src/lib/bedrock.mjs";
import { sign } from "../../src/lib/sigv4.mjs";

const date = new Date("2026-11-19T17:00:00Z");
const keys = { accessKeyId: "AKIDEXAMPLE", secretAccessKey: "secret" };
const failure = (run) => {
	try {
		run();
	} catch (error) {
		return error;
	}
	return null;
};
const runtime = "https://bedrock-runtime.us-east-1.amazonaws.com";
const call = {
	method: "POST",
	url: "https://bedrock-runtime.us-east-1.amazonaws.com/model/m/invoke",
	headers: { "content-type": "application/json" },
	body: "{}"
};

describe("claude()", () => {
	it("recognizes Claude ids, inference profiles with a geography prefix and ARNs", () => {
		for (const id of [
			"anthropic.claude-sonnet-4-5-20250929-v1:0",
			"us.anthropic.claude-3-5-sonnet-20241022-v2:0",
			"eu.anthropic.claude-3-haiku-20240307-v1:0",
			"apac.anthropic.claude-3-haiku-20240307-v1:0",
			"global.anthropic.claude-sonnet-4-5-20250929-v1:0",
			"us-gov.anthropic.claude-3-5-sonnet-20240620-v1:0",
			"arn:aws:bedrock:us-east-1::foundation-model/anthropic.claude-3-haiku-20240307-v1:0",
			"arn:aws:bedrock:us-east-1:123456789012:inference-profile/us.anthropic.claude-3-haiku-20240307-v1:0"
		]) {
			expect(claude(id), id).toBe(true);
		}
	});

	it("leaves every other model, an opaque profile and a non-string to Converse", () => {
		for (const id of [
			"amazon.nova-pro-v1:0",
			"meta.llama3-1-70b-instruct-v1:0",
			"mistral.mistral-large-2407-v1:0",
			"arn:aws:bedrock:us-east-1:123456789012:application-inference-profile/abc123",
			"notanthropic.claude-3",
			"claude-sonnet-4-5",
			undefined,
			42
		]) {
			expect(claude(id), String(id)).toBe(false);
		}
	});
});

describe("regions and URLs", () => {
	it("reads the region out of a runtime host: public, FIPS, VPC endpoint, China", () => {
		expect(regionOfHost("bedrock-runtime.us-east-1.amazonaws.com")).toBe("us-east-1");
		expect(regionOfHost("bedrock-runtime-fips.us-gov-west-1.amazonaws.com")).toBe("us-gov-west-1");
		expect(regionOfHost("vpce-0abc-xyz.bedrock-runtime.eu-west-1.vpce.amazonaws.com")).toBe("eu-west-1");
		expect(regionOfHost("bedrock-runtime.cn-north-1.amazonaws.com.cn")).toBe("cn-north-1");
		expect(regionOfHost("bedrock.us-east-1.amazonaws.com")).toBeNull();
		expect(regionOfHost("evil-bedrock-runtime.us-east-1.amazonaws.com.example.com")).toBeNull();
		expect(regionOfHost("s3.us-east-1.amazonaws.com")).toBeNull();
	});

	it("regionOf: the setting, then the host, then AWS_REGION, then AWS_DEFAULT_REGION", () => {
		const url = "https://bedrock-runtime.eu-west-1.amazonaws.com";
		expect(regionOf({ region: "ap-south-1", url }, {})).toBe("ap-south-1");
		expect(regionOf({ url }, { AWS_REGION: "us-east-1" })).toBe("eu-west-1");
		expect(regionOf({ url: "http://127.0.0.1:9" }, { AWS_REGION: "us-east-1", AWS_DEFAULT_REGION: "us-west-2" })).toBe("us-east-1");
		expect(regionOf({ url: "http://127.0.0.1:9" }, { AWS_DEFAULT_REGION: "us-west-2" })).toBe("us-west-2");
		expect(regionOf({}, {})).toBeNull();
		expect(regionOf({ url: "not a url" }, {})).toBeNull();
	});

	it("defaultUrl builds the runtime URL of a region and refuses without one", () => {
		expect(defaultUrl({ region: "us-east-1" }, {})).toBe("https://bedrock-runtime.us-east-1.amazonaws.com");
		expect(defaultUrl({}, { AWS_REGION: "eu-central-1" })).toBe("https://bedrock-runtime.eu-central-1.amazonaws.com");
		expect(defaultUrl({ region: "cn-north-1" }, {})).toBe("https://bedrock-runtime.cn-north-1.amazonaws.com.cn");
		expect(failure(() => defaultUrl({}, {}))).toMatchObject({ code: "INVALID_CONFIG" });
	});

	it("modelPath encodes ids and ARNs as one path segment", () => {
		expect(modelPath("anthropic.claude-3-5-sonnet-20241022-v2:0")).toBe("/model/anthropic.claude-3-5-sonnet-20241022-v2%3A0");
		expect(modelPath("arn:aws:bedrock:us-east-1:1:inference-profile/us.amazon.nova-pro-v1:0")).toBe(
			"/model/arn%3Aaws%3Abedrock%3Aus-east-1%3A1%3Ainference-profile%2Fus.amazon.nova-pro-v1%3A0"
		);
	});
});

describe("credentials", () => {
	it("prefers the upstream's own settings to the environment, an API key to access keys", () => {
		const env = { AWS_BEARER_TOKEN_BEDROCK: "env-token", AWS_ACCESS_KEY_ID: "ENVKEY", AWS_SECRET_ACCESS_KEY: "envsecret" };
		expect(credential({ apiKey: "own-key", ...keys }, env)).toEqual({ bearer: "own-key" });
		expect(credential({ ...keys, sessionToken: "t" }, env)).toEqual({ keys: { ...keys, sessionToken: "t" } });
		expect(credential({}, env)).toEqual({ bearer: "env-token" });
		expect(credential({}, { AWS_ACCESS_KEY_ID: "ENVKEY", AWS_SECRET_ACCESS_KEY: "envsecret", AWS_SESSION_TOKEN: "envtoken" })).toEqual({
			keys: { accessKeyId: "ENVKEY", secretAccessKey: "envsecret", sessionToken: "envtoken" }
		});
		expect(
			credential({}, { AWS_ACCESS_KEY_ID: "ENVKEY", AWS_SECRET_ACCESS_KEY: "envsecret", AWS_SESSION_TOKEN: "" }).keys.sessionToken
		).toBeUndefined();
		expect(credential({ accessKeyId: "only-id" }, {})).toBeNull();
		expect(credential({}, { AWS_ACCESS_KEY_ID: "only-id" })).toBeNull();
	});

	it("a Bedrock API key becomes a bearer token and replaces any authorization header", () => {
		const out = authenticate(
			{ name: "b", apiKey: "bk" },
			{ ...call, headers: { ...call.headers, authorization: "Bearer stale" } },
			{ env: {} }
		);
		expect(out).toEqual({ "content-type": "application/json", authorization: "Bearer bk" });
	});

	it("access keys sign the call with SigV4 for the service bedrock in the host's region", () => {
		const out = authenticate({ name: "b", url: runtime, ...keys, sessionToken: "tok" }, call, { env: {}, date });
		const expected = sign({ ...call, ...keys, sessionToken: "tok", region: "us-east-1", service: "bedrock", date });
		expect(out).toEqual(expected.headers);
		expect(out["x-amz-security-token"]).toBe("tok");
		expect(out.authorization).toContain("/20261119/us-east-1/bedrock/aws4_request");
	});

	it("takes the signing time from the clock by default", () => {
		const out = authenticate({ name: "b", url: runtime, ...keys }, call, { env: {} });
		expect(out["x-amz-date"]).toMatch(/^\d{8}T\d{6}Z$/);
		expect(authenticate({ name: "b", url: runtime, ...keys }, call)["x-amz-date"]).toMatch(/^\d{8}T\d{6}Z$/);
	});

	it("fails with a clear error without a credential, and without a region for SigV4", () => {
		expect(failure(() => authenticate({ name: "b" }, call, { env: {} }))).toMatchObject({ code: "missing_credentials", status: 500 });
		const local = { ...call, url: "http://127.0.0.1:9/model/m/invoke" };
		expect(failure(() => authenticate({ name: "b", ...keys, url: "http://127.0.0.1:9" }, local, { env: {} }))).toMatchObject({
			code: "missing_region",
			status: 500
		});
		expect(authenticate({ name: "b", apiKey: "k", url: "http://127.0.0.1:9" }, local, { env: {} }).authorization).toBe("Bearer k");
	});
});
