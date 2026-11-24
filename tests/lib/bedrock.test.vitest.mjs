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
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { authenticate, claude, credential, defaultUrl, modelPath, regionOf, regionOfHost } from "../../src/lib/bedrock.mjs";
import { sign } from "../../src/lib/sigv4.mjs";
import { reset } from "../../src/lib/aws-credentials.mjs";

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
const rejection = async (run) => {
	try {
		await run();
	} catch (error) {
		return error;
	}
	return null;
};
// No shared files and no metadata service: the chain finds nothing unless a test gives it something.
const none = {
	AWS_CONFIG_FILE: "/nonexistent/config",
	AWS_SHARED_CREDENTIALS_FILE: "/nonexistent/credentials",
	AWS_EC2_METADATA_DISABLED: "true"
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

	it("a Bedrock API key becomes a bearer token and replaces any authorization header", async () => {
		const out = await authenticate(
			{ name: "b", apiKey: "bk" },
			{ ...call, headers: { ...call.headers, authorization: "Bearer stale" } },
			{ env: none }
		);
		expect(out).toEqual({ "content-type": "application/json", authorization: "Bearer bk" });
	});

	it("access keys sign the call with SigV4 for the service bedrock in the host's region", async () => {
		const out = await authenticate({ name: "b", url: runtime, ...keys, sessionToken: "tok" }, call, { env: none, date });
		const expected = sign({ ...call, ...keys, sessionToken: "tok", region: "us-east-1", service: "bedrock", date });
		expect(out).toEqual(expected.headers);
		expect(out["x-amz-security-token"]).toBe("tok");
		expect(out.authorization).toContain("/20261119/us-east-1/bedrock/aws4_request");
	});

	it("takes the signing time from the clock by default", async () => {
		const out = await authenticate({ name: "b", url: runtime, ...keys }, call, { env: none });
		expect(out["x-amz-date"]).toMatch(/^\d{8}T\d{6}Z$/);
		expect((await authenticate({ name: "b", url: runtime, ...keys }, call))["x-amz-date"]).toMatch(/^\d{8}T\d{6}Z$/);
	});

	it("fails with a clear error without a credential, and without a region for SigV4", async () => {
		expect(await rejection(() => authenticate({ name: "b" }, call, { env: none }))).toMatchObject({
			code: "missing_credentials",
			status: 500
		});
		const local = { ...call, url: "http://127.0.0.1:9/model/m/invoke" };
		expect(await rejection(() => authenticate({ name: "b", ...keys, url: "http://127.0.0.1:9" }, local, { env: none }))).toMatchObject({
			code: "missing_region",
			status: 500
		});
		expect((await authenticate({ name: "b", apiKey: "k", url: "http://127.0.0.1:9" }, local, { env: none })).authorization).toBe(
			"Bearer k"
		);
	});
});

describe("the AWS credential chain", () => {
	const dirs = [];
	afterEach(() => {
		reset();
		while (dirs.length > 0) fs.rmSync(dirs.pop(), { recursive: true, force: true });
	});
	const files = (config, credentials = "") => {
		fs.mkdirSync(path.join(process.cwd(), "tmp"), { recursive: true });
		const dir = fs.mkdtempSync(path.join(process.cwd(), "tmp", "bedrock-chain-"));
		dirs.push(dir);
		fs.writeFileSync(path.join(dir, "config"), config);
		fs.writeFileSync(path.join(dir, "credentials"), credentials);
		return { ...none, HOME: dir, AWS_CONFIG_FILE: path.join(dir, "config"), AWS_SHARED_CREDENTIALS_FILE: path.join(dir, "credentials") };
	};
	const profiles =
		"[default]\naws_access_key_id = DEFAULTKEY\naws_secret_access_key = s1\nregion = eu-west-3\n[work]\naws_access_key_id = WORKKEY\naws_secret_access_key = s2\n";
	const local = { ...call, url: "http://127.0.0.1:9/model/m/invoke" };
	const keyOf = (headers) => /Credential=([^/]+)\//.exec(headers.authorization)[1];

	it("signs with the default profile after the explicit settings and the environment, in the region the profile names", async () => {
		const env = files("", profiles);
		const out = await authenticate({ name: "b", url: "http://127.0.0.1:9" }, local, { env, date });
		expect(keyOf(out)).toBe("DEFAULTKEY");
		expect(out.authorization).toContain("/eu-west-3/bedrock/");
		// The environment's keys, a Bedrock API key and the upstream's own keys all come first.
		expect(
			keyOf(
				await authenticate({ name: "b", url: runtime }, call, { env: { ...env, AWS_ACCESS_KEY_ID: "ENVKEY", AWS_SECRET_ACCESS_KEY: "e" } })
			)
		).toBe("ENVKEY");
		expect((await authenticate({ name: "b" }, call, { env: { ...env, AWS_BEARER_TOKEN_BEDROCK: "tok" } })).authorization).toBe(
			"Bearer tok"
		);
		expect(keyOf(await authenticate({ name: "b", url: runtime, ...keys }, call, { env }))).toBe("AKIDEXAMPLE");
		// The region of the URL, the setting or the environment wins over the profile's.
		expect((await authenticate({ name: "b", url: runtime }, call, { env, date })).authorization).toContain("/us-east-1/bedrock/");
	});

	it("the profile setting beats the environment's keys, and AWS_PROFILE does not", async () => {
		const env = { ...files("", profiles), AWS_ACCESS_KEY_ID: "ENVKEY", AWS_SECRET_ACCESS_KEY: "e" };
		expect(keyOf(await authenticate({ name: "b", url: runtime, profile: "work" }, call, { env }))).toBe("WORKKEY");
		expect(keyOf(await authenticate({ name: "b", url: runtime }, call, { env: { ...env, AWS_PROFILE: "work" } }))).toBe("ENVKEY");
		expect(keyOf(await authenticate({ name: "b", url: runtime }, call, { env: { ...files("", profiles), AWS_PROFILE: "work" } }))).toBe(
			"WORKKEY"
		);
		// An upstream's own keys beat its profile.
		expect(keyOf(await authenticate({ name: "b", url: runtime, profile: "work", ...keys }, call, { env }))).toBe("AKIDEXAMPLE");
	});

	it("reports a profile that does not work, and the lookups go through the transport it is given", async () => {
		const env = files("", profiles);
		expect(await rejection(() => authenticate({ name: "b", url: runtime, profile: "ghost" }, call, { env }))).toMatchObject({
			code: "upstream_auth"
		});
		const config = files("[profile sso]\nsso_start_url = u\nsso_region = us-east-1\nsso_account_id = 1\nsso_role_name = R\n");
		const login = path.join(config.HOME, ".aws", "sso", "cache");
		fs.mkdirSync(login, { recursive: true });
		const { createHash } = await import("node:crypto");
		fs.writeFileSync(
			path.join(login, `${createHash("sha1").update("u").digest("hex")}.json`),
			JSON.stringify({ accessToken: "t", expiresAt: "2099-01-01T00:00:00Z" })
		);
		const seen = [];
		const transport = async (url) => {
			seen.push(url);
			return new Response(JSON.stringify({ roleCredentials: { accessKeyId: "SSOKEY", secretAccessKey: "x" } }));
		};
		const out = await authenticate({ name: "b", url: runtime, profile: "sso" }, call, { env: config, transport, timeout: 5000 });
		expect(keyOf(out)).toBe("SSOKEY");
		expect(seen[0]).toMatch(/^https:\/\/portal\.sso\.us-east-1\.amazonaws\.com\/federation\/credentials\?/);
	});
});
