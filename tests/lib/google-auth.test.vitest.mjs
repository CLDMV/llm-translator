/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /tests/lib/google-auth.test.vitest.mjs
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
 * @fileoverview Google access tokens: the service-account JWT, token caching and refresh, the authorized_user grant, the metadata server and the
 * order of the sources. Every token request goes to a local server.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as google from "../../src/lib/google-auth.mjs";
import { authorizedUser, fakeGoogle, keys, serviceAccount } from "../helpers/google.mjs";

const servers = [];
const dirs = [];
const start = async (options) => {
	const server = await fakeGoogle(options);
	servers.push(server);
	return server;
};
const scratch = () => {
	const dir = fs.mkdtempSync(path.join(process.cwd(), "tmp", "google-auth-"));
	dirs.push(dir);
	return dir;
};
// Every call looks for gcloud's credentials file in an empty folder, never in the real home directory.
let empty;
const get = (extra = {}) => ({ transport: fetch, ...extra, env: { CLOUDSDK_CONFIG: empty, ...extra.env } });

beforeEach(() => {
	google.reset();
	empty = scratch();
});
afterEach(async () => {
	while (servers.length > 0) await servers.pop().close();
	while (dirs.length > 0) fs.rmSync(dirs.pop(), { recursive: true, force: true });
});

describe("assertion", () => {
	it("is an RS256 JWT with the claims Google expects, signed with the key", () => {
		const jwt = google.assertion(serviceAccount("https://token.example/t"), { now: 1_700_000_000_000 });
		const [header, claims, signature] = jwt.split(".");
		expect(JSON.parse(Buffer.from(header, "base64url"))).toEqual({ alg: "RS256", typ: "JWT", kid: "key-1" });
		expect(JSON.parse(Buffer.from(claims, "base64url"))).toEqual({
			iss: "bot@sa-project.iam.gserviceaccount.com",
			scope: google.SCOPE,
			aud: "https://token.example/t",
			iat: 1_700_000_000,
			exp: 1_700_003_600
		});
		const verify = crypto.createVerify("RSA-SHA256").update(`${header}.${claims}`);
		expect(verify.verify(keys.publicKey, Buffer.from(signature, "base64url"))).toBe(true);
		expect(jwt).not.toMatch(/[+/=]/);
	});

	it("omits the key id when the key has none, defaults the audience and the clock, and takes another scope", () => {
		const { private_key_id: ___id, token_uri: ___uri, ...bare } = serviceAccount("x");
		const [header, claims] = google.assertion(bare, { scope: "scope-x" }).split(".");
		expect(JSON.parse(Buffer.from(header, "base64url"))).toEqual({ alg: "RS256", typ: "JWT" });
		const parsed = JSON.parse(Buffer.from(claims, "base64url"));
		expect(parsed).toMatchObject({ aud: google.TOKEN_URI, scope: "scope-x" });
		expect(Math.abs(parsed.iat - Date.now() / 1000)).toBeLessThan(5);
		expect(google.assertion(bare)).toMatch(/^[\w-]+\.[\w-]+\.[\w-]+$/);
	});

	it("reports a key that cannot sign without echoing it", () => {
		const bad = serviceAccount("x", { private_key: "-----BEGIN PRIVATE KEY-----\nnot a key\n-----END PRIVATE KEY-----" });
		expect(() => google.assertion(bad)).toThrow(/cannot sign/);
		expect(() => google.assertion(bad)).not.toThrow(/not a key/);
	});
});

describe("wellKnown", () => {
	it("follows CLOUDSDK_CONFIG, then APPDATA on Windows, then the home directory", () => {
		expect(google.wellKnown({ CLOUDSDK_CONFIG: "/c" })).toBe(path.join("/c", "application_default_credentials.json"));
		expect(google.wellKnown({ APPDATA: "/a", HOME: "/h" }, "win32")).toBe(
			path.join("/a", "gcloud", "application_default_credentials.json")
		);
		expect(google.wellKnown({ HOME: "/h" }, "win32")).toBe(path.join("/h", ".config", "gcloud", "application_default_credentials.json"));
		expect(google.wellKnown({ HOME: "/h" }, "linux")).toBe(path.join("/h", ".config", "gcloud", "application_default_credentials.json"));
		expect(google.wellKnown({ USERPROFILE: "/u" })).toBe(path.join("/u", ".config", "gcloud", "application_default_credentials.json"));
		expect(google.wellKnown({})).toBe(path.join(os.homedir(), ".config", "gcloud", "application_default_credentials.json"));
	});
});

describe("credentials", () => {
	it("takes an object, JSON text or a file path from the setting", () => {
		const key = serviceAccount("x");
		expect(google.credentials({ credentials: key }, {})).toBe(key);
		expect(google.credentials({ credentials: ` ${JSON.stringify(key)}` }, {})).toEqual(key);
		const file = path.join(scratch(), "key.json");
		fs.writeFileSync(file, JSON.stringify(key));
		expect(google.credentials({ credentials: file }, {})).toEqual(key);
		// The file is read once.
		fs.rmSync(file);
		expect(google.credentials({ credentials: file }, {})).toEqual(key);
	});

	it("falls back to GOOGLE_APPLICATION_CREDENTIALS, then gcloud's application default credentials, then none", () => {
		const dir = scratch();
		const named = path.join(dir, "named.json");
		fs.writeFileSync(named, JSON.stringify(serviceAccount("x")));
		expect(google.credentials({}, { GOOGLE_APPLICATION_CREDENTIALS: named })).toMatchObject({ type: "service_account" });
		expect(google.credentials(undefined, { GOOGLE_APPLICATION_CREDENTIALS: named })).toMatchObject({ type: "service_account" });
		expect(google.credentials({ credentials: authorizedUser() }, { GOOGLE_APPLICATION_CREDENTIALS: named })).toMatchObject({
			type: "authorized_user"
		});
		expect(google.credentials({}, { CLOUDSDK_CONFIG: dir })).toBeNull();
		fs.writeFileSync(path.join(dir, "application_default_credentials.json"), JSON.stringify(authorizedUser()));
		expect(google.credentials({}, { CLOUDSDK_CONFIG: dir })).toMatchObject({ type: "authorized_user", refresh_token: "refresh-1" });
		expect(google.credentials({}, { CLOUDSDK_CONFIG: dir })).toMatchObject({ type: "authorized_user" });
	});

	it("reads the process environment by default", () => {
		const saved = process.env.GOOGLE_APPLICATION_CREDENTIALS;
		process.env.GOOGLE_APPLICATION_CREDENTIALS = JSON.stringify(authorizedUser());
		try {
			expect(google.credentials({})).toMatchObject({ type: "authorized_user" });
		} finally {
			if (saved === undefined) delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
			else process.env.GOOGLE_APPLICATION_CREDENTIALS = saved;
		}
	});

	it("rejects what it cannot use, with a message that names the source", () => {
		const dir = scratch();
		const text = path.join(dir, "text.json");
		fs.writeFileSync(text, "not json");
		expect(() => google.credentials({ credentials: 7 }, {})).toThrow(/credentials setting.*object or a file path/);
		expect(() => google.credentials({ credentials: "{nope" }, {})).toThrow(/JSON text does not parse/);
		expect(() => google.credentials({ credentials: '{"type":"bogus"}' }, {})).toThrow(/type "bogus" is not supported/);
		expect(() => google.credentials({ credentials: path.join(dir, "missing.json") }, {})).toThrow(/cannot read .*missing\.json \(ENOENT\)/);
		expect(() => google.credentials({ credentials: text }, {})).toThrow(/is not JSON/);
		expect(() => google.credentials({ credentials: { type: "external_account" } }, {})).toThrow(/type "external_account" is not supported/);
		expect(() => google.credentials({ credentials: {} }, {})).toThrow(/type undefined is not supported/);
		expect(() => google.credentials({ credentials: { type: "service_account", client_email: "a" } }, {})).toThrow(/missing private_key/);
		expect(() => google.credentials({ credentials: { type: "authorized_user", client_id: "a" } }, {})).toThrow(
			/missing client_secret, refresh_token/
		);
		expect(() => google.credentials({}, { GOOGLE_APPLICATION_CREDENTIALS: text })).toThrow(
			/\(GOOGLE_APPLICATION_CREDENTIALS\).*text\.json/
		);
		try {
			google.credentials({ credentials: { type: "service_account", client_email: "a" } }, {});
		} catch (error) {
			expect(error).toMatchObject({ code: "upstream_auth", status: 401 });
		}
	});
});

describe("token from a service account", () => {
	it("sends the signed assertion to the key's token endpoint as a form and returns the access token", async () => {
		const server = await start();
		const settings = { credentials: serviceAccount(server.tokenUrl) };
		expect(await google.token(get({ settings }))).toBe("ya29.1");
		const [request] = server.tokens;
		expect(request.headers["content-type"]).toBe("application/x-www-form-urlencoded");
		expect(request.form.grant_type).toBe("urn:ietf:params:oauth:grant-type:jwt-bearer");
		const [header, claims, signature] = request.form.assertion.split(".");
		expect(JSON.parse(Buffer.from(claims, "base64url"))).toMatchObject({ aud: server.tokenUrl, scope: google.SCOPE });
		expect(
			crypto.createVerify("RSA-SHA256").update(`${header}.${claims}`).verify(keys.publicKey, Buffer.from(signature, "base64url"))
		).toBe(true);
	});

	it("caches the token until a minute before it expires, then refreshes", async () => {
		const server = await start({ token: (_record, count) => ({ body: { access_token: `t${count}`, expires_in: 600 } }) });
		const settings = { credentials: serviceAccount(server.tokenUrl) };
		let clock = 1_000_000;
		const options = get({ settings, now: () => clock });
		expect(await google.token(options)).toBe("t1");
		clock += 539_000;
		expect(await google.token(options)).toBe("t1");
		clock += 2_000;
		expect(await google.token(options)).toBe("t2");
		expect(server.tokens).toHaveLength(2);
	});

	it("shares one refresh between concurrent requests", async () => {
		const server = await start();
		const options = get({ settings: { credentials: serviceAccount(server.tokenUrl) } });
		const all = await Promise.all([google.token(options), google.token(options), google.token(options)]);
		expect(all).toEqual(["ya29.1", "ya29.1", "ya29.1"]);
		expect(server.tokens).toHaveLength(1);
	});

	it("keeps accounts and token endpoints apart, and uses a token without a lifetime once", async () => {
		const server = await start({ token: (_record, count) => ({ body: { access_token: `t${count}` } }) });
		const first = get({ settings: { credentials: serviceAccount(server.tokenUrl) } });
		const second = get({ settings: { credentials: serviceAccount(server.tokenUrl, { client_email: "other@x.iam.gserviceaccount.com" }) } });
		expect(await google.token(first)).toBe("t1");
		expect(await google.token(first)).toBe("t2");
		expect(await google.token(second)).toBe("t3");
	});

	it("does not cache a failed refresh", async () => {
		const server = await start({
			token: (_record, count) => (count === 1 ? { status: 503, body: "busy" } : { body: { access_token: "ok", expires_in: 60 } })
		});
		const options = get({ settings: { credentials: serviceAccount(server.tokenUrl) } });
		await expect(google.token(options)).rejects.toMatchObject({
			code: "upstream_auth",
			status: 502,
			message: expect.stringContaining("HTTP 503")
		});
		expect(await google.token(options)).toBe("ok");
	});

	it("reports Google's refusal by status and detail, without the key", async () => {
		const cases = [
			[
				{ status: 400, body: { error: "invalid_grant", error_description: "Invalid JWT Signature." } },
				/HTTP 400\): Invalid JWT Signature\./
			],
			[{ status: 401, body: { error: "invalid_client" } }, /HTTP 401\): invalid_client/],
			[{ status: 403, body: { error: { message: "denied" } } }, /HTTP 403\): denied/],
			[{ status: 400, body: "<html>" }, /HTTP 400\)$/]
		];
		for (const [reply, message] of cases) {
			google.reset();
			const server = await start({ token: () => reply });
			const failure = await google.token(get({ settings: { credentials: serviceAccount(server.tokenUrl) } })).catch((error) => error);
			expect(failure).toMatchObject({ code: "upstream_auth", status: 401 });
			expect(failure.message).toMatch(message);
			expect(failure.message).not.toContain("BEGIN PRIVATE KEY");
		}
	});

	it("reports an unreachable token endpoint and a reply without a token as 502", async () => {
		const server = await start({ token: () => ({ body: { expires_in: 5 } }) });
		const options = get({ settings: { credentials: serviceAccount(server.tokenUrl) } });
		await expect(google.token(options)).rejects.toMatchObject({ status: 502, message: expect.stringContaining("without an access_token") });
		await server.close();
		servers.pop();
		google.reset();
		await expect(google.token(options)).rejects.toMatchObject({ status: 502, message: expect.stringContaining("failed:") });
	});

	it("gives up on a token endpoint that does not answer within the timeout", async () => {
		const server = await start({ token: () => new Promise(() => {}) });
		await expect(google.token(get({ settings: { credentials: serviceAccount(server.tokenUrl) }, timeout: 50 }))).rejects.toMatchObject({
			status: 502
		});
	});
});

describe("token from an authorized_user file", () => {
	it("trades the refresh token (the gcloud file has no token endpoint, so the settings' one is the credentials' token_uri)", async () => {
		const server = await start();
		const settings = { credentials: authorizedUser(server.tokenUrl) };
		expect(await google.token(get({ settings }))).toBe("ya29.1");
		expect(server.tokens[0].form).toEqual({
			grant_type: "refresh_token",
			client_id: "client-1",
			client_secret: "secret-1",
			refresh_token: "refresh-1"
		});
		expect(await google.token(get({ settings }))).toBe("ya29.1");
		expect(server.tokens).toHaveLength(1);
	});

	it("uses Google's token endpoint when the file names none", async () => {
		const seen = [];
		const transport = async (url, init) => {
			seen.push({ url, body: init.body });
			return new Response(JSON.stringify({ access_token: "from-google", expires_in: 3600 }), { status: 200 });
		};
		const settings = { credentials: authorizedUser() };
		expect(await google.token({ settings, transport, env: { CLOUDSDK_CONFIG: empty } })).toBe("from-google");
		expect(seen[0].url).toBe(google.TOKEN_URI);
	});
});

describe("token from the metadata server", () => {
	it("is used only when enabled, sends Metadata-Flavor and caches", async () => {
		const server = await start({ metadata: (_record, count) => ({ body: { access_token: `m${count}`, expires_in: 3600 } }) });
		await expect(google.token(get())).rejects.toThrow(/No Google credentials/);
		expect(server.tokens).toHaveLength(0);
		const settings = { metadataServer: `${server.url}/` };
		expect(await google.token(get({ settings }))).toBe("m1");
		expect(await google.token(get({ settings }))).toBe("m1");
		expect(server.tokens).toHaveLength(1);
		expect(server.tokens[0].headers["metadata-flavor"]).toBe("Google");
	});

	it("defaults to metadata.google.internal for true", async () => {
		const seen = [];
		const transport = async (url) => {
			seen.push(url);
			return new Response(JSON.stringify({ access_token: "gce", expires_in: 100 }), { status: 200 });
		};
		expect(await google.token({ settings: { metadataServer: true }, transport, env: { CLOUDSDK_CONFIG: empty } })).toBe("gce");
		expect(seen[0]).toBe(`${google.METADATA_URL}/computeMetadata/v1/instance/service-accounts/default/token`);
	});
});

describe("token sources and their order", () => {
	const file = (dir, name, content) => {
		const target = path.join(dir, name);
		fs.writeFileSync(target, JSON.stringify(content));
		return target;
	};

	it("getToken comes first, is called on every request and may return a string or { token }", async () => {
		const calls = [];
		const settings = {
			getToken: async (context) => {
				calls.push(context);
				return calls.length === 1 ? "one" : { token: "two" };
			},
			accessToken: "static",
			credentials: authorizedUser()
		};
		const signal = AbortSignal.timeout(1000);
		expect(await google.token(get({ settings, apiKey: "key", signal }))).toBe("one");
		expect(await google.token(get({ settings }))).toBe("two");
		expect(calls[0].signal).toBe(signal);
	});

	it("reports a getToken that fails or returns nothing", async () => {
		const fail = (getToken) => google.token(get({ settings: { getToken } })).catch((error) => error);
		expect((await fail(async () => Promise.reject(new Error("no gcloud")))).message).toBe("Google getToken failed: no gcloud");
		expect((await fail(() => Promise.reject("plain"))).message).toBe("Google getToken failed: plain");
		expect((await fail(() => Promise.reject(null))).message).toBe("Google getToken failed: null");
		for (const value of ["", undefined, null, 5, {}]) {
			expect(await fail(async () => value)).toMatchObject({ code: "upstream_auth", message: "Google getToken returned no access token" });
		}
	});

	it("then accessToken, then the upstream's apiKey, then the credentials setting, none of them calling Google", async () => {
		const server = await start();
		const credentials = authorizedUser(server.tokenUrl);
		expect(await google.token(get({ settings: { accessToken: "static", credentials }, apiKey: "key" }))).toBe("static");
		expect(await google.token(get({ settings: { credentials }, apiKey: "key", env: { GOOGLE_ACCESS_TOKEN: "env" } }))).toBe("key");
		expect(await google.token(get({ settings: { accessToken: "", credentials }, apiKey: "" }))).toBe("ya29.1");
		expect(await google.token(get({ settings: { credentials }, env: { GOOGLE_ACCESS_TOKEN: "env" } }))).toBe("ya29.1");
		expect(server.tokens).toHaveLength(1);
	});

	it("then GOOGLE_ACCESS_TOKEN, then GOOGLE_APPLICATION_CREDENTIALS, then the application default credentials file", async () => {
		const server = await start();
		const dir = scratch();
		const named = file(dir, "named.json", authorizedUser(server.tokenUrl, { refresh_token: "from-env-path" }));
		file(dir, "application_default_credentials.json", authorizedUser(server.tokenUrl, { refresh_token: "from-adc" }));
		const env = { CLOUDSDK_CONFIG: dir };
		expect(await google.token(get({ env: { ...env, GOOGLE_ACCESS_TOKEN: "env-token", GOOGLE_APPLICATION_CREDENTIALS: named } }))).toBe(
			"env-token"
		);
		expect(await google.token(get({ env: { ...env, GOOGLE_APPLICATION_CREDENTIALS: named } }))).toBe("ya29.1");
		expect(server.tokens[0].form.refresh_token).toBe("from-env-path");
		expect(await google.token(get({ env }))).toBe("ya29.2");
		expect(server.tokens[1].form.refresh_token).toBe("from-adc");
	});

	it("ends with an error that lists every way to authenticate", async () => {
		const failure = await google.token(get()).catch((error) => error);
		expect(failure).toMatchObject({ code: "upstream_auth", status: 401 });
		for (const name of [
			"getToken",
			"accessToken",
			"credentials",
			"GOOGLE_ACCESS_TOKEN",
			"GOOGLE_APPLICATION_CREDENTIALS",
			"metadataServer",
			"gcloud auth application-default login"
		]) {
			expect(failure.message).toContain(name);
		}
	});

	it("reads the process environment by default", async () => {
		const saved = process.env.GOOGLE_ACCESS_TOKEN;
		process.env.GOOGLE_ACCESS_TOKEN = "from-process";
		try {
			expect(await google.token({ transport: fetch })).toBe("from-process");
		} finally {
			if (saved === undefined) delete process.env.GOOGLE_ACCESS_TOKEN;
			else process.env.GOOGLE_ACCESS_TOKEN = saved;
		}
	});
});
