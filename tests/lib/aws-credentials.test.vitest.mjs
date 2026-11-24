/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /tests/lib/aws-credentials.test.vitest.mjs
 *	@Date: 2026-11-22T09:00:00-08:00 (1795370400)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-11-22T09:00:00-08:00 (1795370400)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

/**
 * @fileoverview AWS credentials without the SDK: the shared files and their profiles, `credential_process`, SSO, ECS container credentials, the EC2 metadata service, the order of the sources and the cache. Every request goes to a fake transport and every file is in a scratch folder.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { chained, load, parseIni, reset, words } from "../../src/lib/aws-credentials.mjs";

const dirs = [];
const scratch = () => {
	fs.mkdirSync(path.join(process.cwd(), "tmp"), { recursive: true });
	const dir = fs.mkdtempSync(path.join(process.cwd(), "tmp", "aws-credentials-"));
	dirs.push(dir);
	return dir;
};
const write = (dir, name, text) => {
	fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
	fs.writeFileSync(path.join(dir, name), text);
	return path.join(dir, name);
};
const sha1 = (text) => crypto.createHash("sha1").update(text).digest("hex");
const answer = (body, status = 200) => new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
/** A transport that answers from `routes(url, init)` (a Response, or an Error to throw) and records the calls. */
const fake = (routes) => {
	const calls = [];
	const transport = async (url, init) => {
		calls.push({ url, init });
		const result = await routes(url, init);
		if (result instanceof Error) throw result;
		return result;
	};
	transport.calls = calls;
	return transport;
};
const nothing = fake(() => {
	throw new Error("no request expected");
});

let home;
// Every call reads files in an empty folder and has the metadata service off, unless a test says otherwise.
const env = (extra = {}) => ({
	HOME: home,
	AWS_CONFIG_FILE: path.join(home, "none-config"),
	AWS_SHARED_CREDENTIALS_FILE: path.join(home, "none-credentials"),
	AWS_EC2_METADATA_DISABLED: "true",
	...extra
});
const lookup = (extra = {}) => chained({ transport: nothing, ...extra, env: env(extra.env) });

beforeEach(() => {
	reset();
	home = scratch();
});
afterEach(() => {
	while (dirs.length > 0) fs.rmSync(dirs.pop(), { recursive: true, force: true });
});

describe("parseIni", () => {
	it("reads profiles and sso-sessions from the config file, skips comments, nested blocks and sections that are not profiles", () => {
		const { profiles, sessions } = parseIni(
			[
				"# a comment",
				"; another",
				"orphan = line before any section",
				"[default]",
				"region = us-east-1",
				"[profile dev]",
				"sso_session = work",
				"s3 =",
				"  max_concurrent_requests = 10",
				"no equals sign here",
				"[sso-session work]",
				"sso_start_url = https://example.awsapps.com/start",
				"[services extra]",
				"endpoint = x",
				"[ profile  spaced ]",
				"region=eu-west-1",
				""
			].join("\r\n"),
			true
		);
		expect([...profiles.keys()]).toEqual(["default", "dev", "spaced"]);
		expect(profiles.get("default")).toEqual({ region: "us-east-1" });
		expect(profiles.get("dev")).toEqual({ sso_session: "work", s3: "" });
		expect(profiles.get("spaced")).toEqual({ region: "eu-west-1" });
		expect(sessions.get("work")).toEqual({ sso_start_url: "https://example.awsapps.com/start" });
	});

	it("merges a section that is written twice", () => {
		const { profiles } = parseIni("[default]\nregion = a\n[other]\nx = 1\n[default]\naws_access_key_id = K\n", true);
		expect(profiles.get("default")).toEqual({ region: "a", aws_access_key_id: "K" });
	});

	it("takes every header of the credentials file as a profile name", () => {
		const { profiles } = parseIni("[default]\naws_access_key_id = A\n[other]\naws_access_key_id = B\n[ ]\n", false);
		expect(profiles.get("default")).toEqual({ aws_access_key_id: "A" });
		expect(profiles.get("other")).toEqual({ aws_access_key_id: "B" });
		expect(profiles.get("")).toEqual({});
	});
});

describe("words", () => {
	it("splits on whitespace, groups quotes and escapes", () => {
		expect(words("node  /path/to/helper.js --profile 'my profile' \"two words\" a\\ b")).toEqual([
			"node",
			"/path/to/helper.js",
			"--profile",
			"my profile",
			"two words",
			"a b"
		]);
		expect(words('say "a \\" quote" \'back\\slash\' ""')).toEqual(["say", 'a " quote', "back\\slash", ""]);
		expect(words("   ")).toEqual([]);
		expect(words("trailing\\")).toEqual(["trailing\\"]);
		expect(words("\\ lead")).toEqual([" lead"]);
	});
});

describe("load", () => {
	it("reads the config and credentials files and lets the credentials file win for a key", () => {
		const config = write(home, "config", "[profile dev]\nregion = us-west-2\naws_access_key_id = FROMCONFIG\n");
		const shared = write(home, "credentials", "[dev]\naws_access_key_id = FROMSHARED\naws_secret_access_key = S\n");
		const files = load({ AWS_CONFIG_FILE: config, AWS_SHARED_CREDENTIALS_FILE: shared });
		expect(files.profiles.get("dev")).toEqual({ region: "us-west-2", aws_access_key_id: "FROMSHARED", aws_secret_access_key: "S" });
	});

	it("finds ~/.aws/config under HOME by default, and a missing file is an empty one", () => {
		write(home, ".aws/config", "[default]\nregion = ap-south-1\n");
		expect(load({ HOME: home }).profiles.get("default")).toEqual({ region: "ap-south-1" });
		expect(load({ HOME: path.join(home, "elsewhere") }).profiles.size).toBe(0);
	});

	it("falls back to USERPROFILE and then the home directory of the user", () => {
		write(home, ".aws/credentials", "[default]\naws_access_key_id = U\n");
		expect(load({ USERPROFILE: home }).profiles.get("default")).toEqual({ aws_access_key_id: "U" });
		expect(load({}).profiles instanceof Map).toBe(true);
	});
});

describe("profiles with keys", () => {
	it("uses the default profile of the credentials file, with its session token and the region of the config", async () => {
		write(home, "credentials", "[default]\naws_access_key_id = AKIA\naws_secret_access_key = SECRET\naws_session_token = TOKEN\n");
		write(home, "config", "[default]\nregion = eu-central-1\n");
		const found = await lookup({
			env: { AWS_CONFIG_FILE: path.join(home, "config"), AWS_SHARED_CREDENTIALS_FILE: path.join(home, "credentials") }
		});
		expect(found).toEqual({ keys: { accessKeyId: "AKIA", secretAccessKey: "SECRET", sessionToken: "TOKEN" }, region: "eu-central-1" });
	});

	it("takes the profile of the setting, or AWS_PROFILE, and a profile without a token or region has neither", async () => {
		const shared = write(
			home,
			"credentials",
			"[a]\naws_access_key_id = A1\naws_secret_access_key = S1\n[b]\naws_access_key_id = B1\naws_secret_access_key = S2\n"
		);
		const files = { AWS_SHARED_CREDENTIALS_FILE: shared };
		expect(await lookup({ profile: "a", env: files })).toEqual({ keys: { accessKeyId: "A1", secretAccessKey: "S1" } });
		expect(await lookup({ env: { ...files, AWS_PROFILE: "b" } })).toEqual({ keys: { accessKeyId: "B1", secretAccessKey: "S2" } });
		// The setting beats AWS_PROFILE.
		expect((await lookup({ profile: "a", env: { ...files, AWS_PROFILE: "b" } })).keys.accessKeyId).toBe("A1");
	});

	it("fails for a profile that was asked for by name and is missing or names no credentials", async () => {
		const shared = write(home, "credentials", "[empty]\nregion = us-east-1\n");
		await expect(lookup({ profile: "ghost", env: { AWS_SHARED_CREDENTIALS_FILE: shared } })).rejects.toMatchObject({
			code: "upstream_auth",
			message: expect.stringContaining("AWS profile ghost")
		});
		await expect(lookup({ profile: "empty", env: { AWS_SHARED_CREDENTIALS_FILE: shared } })).rejects.toThrow(/AWS profile empty/);
		await expect(lookup({ env: { AWS_PROFILE: "ghost" } })).rejects.toThrow(/AWS profile ghost/);
	});

	it("looks in ~/.aws under HOME when the file variables are not set", async () => {
		write(home, ".aws/credentials", "[default]\naws_access_key_id = HOMEKEY\naws_secret_access_key = S\n");
		const found = await chained({ transport: nothing, env: { HOME: home, AWS_EC2_METADATA_DISABLED: "true" } });
		expect(found.keys.accessKeyId).toBe("HOMEKEY");
	});

	it("has nothing for a missing default profile when no other source is configured", async () => {
		expect(await lookup()).toBeNull();
	});
});

describe("credential_process", () => {
	const profileWith = (command) =>
		write(home, "config", `[profile proc]\ncredential_process = ${command}\nregion = us-west-1\n`) && {
			AWS_CONFIG_FILE: path.join(home, "config")
		};
	const printing =
		(value, error = null) =>
		(file, args, options, done) => {
			printing.seen = { file, args, options };
			done(error, typeof value === "string" ? value : JSON.stringify(value));
		};

	it("runs the command and reads the credentials it prints, with their expiry", async () => {
		const files = profileWith("/bin/helper --flag 'two words'");
		const found = await lookup({
			profile: "proc",
			env: files,
			now: () => Date.parse("2030-01-01T00:00:00Z"),
			run: printing({ Version: 1, AccessKeyId: "PA", SecretAccessKey: "PS", SessionToken: "PT", Expiration: "2030-01-01T01:00:00Z" })
		});
		expect(found).toEqual({ keys: { accessKeyId: "PA", secretAccessKey: "PS", sessionToken: "PT" }, region: "us-west-1" });
		expect(printing.seen.file).toBe("/bin/helper");
		expect(printing.seen.args).toEqual(["--flag", "two words"]);
		expect(printing.seen.options.timeout).toBeGreaterThan(0);
	});

	it("runs a real process with the default runner", async () => {
		const script = write(
			home,
			"helper.mjs",
			`process.stdout.write(JSON.stringify({ Version: 1, AccessKeyId: "REAL", SecretAccessKey: "REALSECRET" }));`
		);
		const files = profileWith(`${process.execPath} ${script}`);
		expect(await lookup({ profile: "proc", env: files })).toMatchObject({ keys: { accessKeyId: "REAL", secretAccessKey: "REALSECRET" } });
	});

	it("fails when the command fails, prints something else, or the setting is empty", async () => {
		const files = profileWith("/bin/helper");
		await expect(
			lookup({ profile: "proc", env: files, run: printing("", Object.assign(new Error("boom"), { code: "ENOENT" })) })
		).rejects.toThrow(/credential_process failed \(ENOENT\)/);
		reset();
		await expect(lookup({ profile: "proc", env: files, run: printing("", new Error("no code")) })).rejects.toThrow(/failed \(no code\)/);
		reset();
		await expect(lookup({ profile: "proc", env: files, run: printing("not json") })).rejects.toThrow(/no version 1 credentials/);
		reset();
		await expect(lookup({ profile: "proc", env: files, run: printing({ Version: 2 }) })).rejects.toThrow(/no version 1 credentials/);
		reset();
		await expect(lookup({ profile: "proc", env: files, run: printing({ Version: 1, AccessKeyId: "A" }) })).rejects.toThrow(
			/no AccessKeyId and SecretAccessKey/
		);
	});
});

describe("SSO", () => {
	const portal = "https://portal.sso.us-east-1.amazonaws.com/federation/credentials";
	const login = (key, token = "TOKEN", expiresAt = "2030-01-01T01:00:00Z") =>
		write(home, `.aws/sso/cache/${sha1(key)}.json`, JSON.stringify({ accessToken: token, expiresAt }));
	const config = (text) => write(home, "config", text) && { AWS_CONFIG_FILE: path.join(home, "config") };
	const now = () => Date.parse("2030-01-01T00:00:00Z");
	const granted = () =>
		fake(() =>
			answer({
				roleCredentials: { accessKeyId: "SA", secretAccessKey: "SS", sessionToken: "ST", expiration: Date.parse("2030-01-01T06:00:00Z") }
			})
		);

	it("exchanges the cached token of an sso-session profile for the role's credentials", async () => {
		const files = config(
			"[profile sso]\nsso_session = work\nsso_account_id = 123456789012\nsso_role_name = Dev\nregion = us-east-2\n[sso-session work]\nsso_start_url = https://x.awsapps.com/start\nsso_region = us-east-1\n"
		);
		login("work");
		const transport = granted();
		const found = await lookup({ profile: "sso", env: files, transport, now });
		expect(found).toEqual({ keys: { accessKeyId: "SA", secretAccessKey: "SS", sessionToken: "ST" }, region: "us-east-2" });
		expect(transport.calls[0].url).toBe(`${portal}?role_name=Dev&account_id=123456789012`);
		expect(transport.calls[0].init.headers).toEqual({ "x-amz-sso_bearer_token": "TOKEN" });
	});

	it("reads a legacy profile whose token is named for the start URL, in the China partition", async () => {
		const files = config(
			"[profile old]\nsso_start_url = https://old.awsapps.com/start\nsso_region = cn-north-1\nsso_account_id = 1\nsso_role_name = R\n"
		);
		login("https://old.awsapps.com/start");
		const transport = fake(() => answer({ roleCredentials: { accessKeyId: "A", secretAccessKey: "S" } }));
		const found = await lookup({ profile: "old", env: files, transport, now });
		expect(found).toEqual({ keys: { accessKeyId: "A", secretAccessKey: "S" } });
		expect(transport.calls[0].url).toMatch(/^https:\/\/portal\.sso\.cn-north-1\.amazonaws\.com\.cn\//);
	});

	it("says what is missing: settings, a login, a live login, an answer", async () => {
		const files = config(
			"[profile bad]\nsso_session = nope\n[profile good]\nsso_start_url = u\nsso_region = us-east-1\nsso_account_id = 1\nsso_role_name = R\n"
		);
		await expect(lookup({ profile: "bad", env: files, now })).rejects.toThrow(/an SSO profile needs/);
		await expect(lookup({ profile: "good", env: files, now })).rejects.toThrow(/no SSO login found; run `aws sso login --profile good`/);
		login("u", "T", "2029-12-31T00:00:00Z");
		await expect(lookup({ profile: "good", env: files, now })).rejects.toThrow(/the SSO login has expired/);
		write(home, `.aws/sso/cache/${sha1("u")}.json`, JSON.stringify({ expiresAt: "2030-02-01T00:00:00Z" }));
		await expect(lookup({ profile: "good", env: files, now })).rejects.toThrow(/has expired/);
		login("u");
		await expect(lookup({ profile: "good", env: files, now, transport: fake(() => new Error("offline")) })).rejects.toMatchObject({
			status: 502,
			message: expect.stringContaining("offline")
		});
		reset();
		await expect(lookup({ profile: "good", env: files, now, transport: fake(() => answer({}, 401)) })).rejects.toThrow(/refused.*HTTP 401/);
		reset();
		await expect(lookup({ profile: "good", env: files, now, transport: fake(() => answer("<html>")) })).rejects.toThrow(/refused/);
	});

	it("takes the expiry from the reply for the cache", async () => {
		const files = config("[profile s]\nsso_start_url = u\nsso_region = us-east-1\nsso_account_id = 1\nsso_role_name = R\n");
		login("u");
		let at = now();
		const transport = granted();
		await lookup({ profile: "s", env: files, transport, now: () => at });
		await lookup({ profile: "s", env: files, transport, now: () => at });
		expect(transport.calls).toHaveLength(1);
		// Six hours later, within the five minute margin of the expiry.
		at = Date.parse("2030-01-01T05:56:00Z");
		login("u", "TOKEN", "2030-01-02T00:00:00Z");
		await lookup({ profile: "s", env: files, transport, now: () => at });
		expect(transport.calls).toHaveLength(2);
	});
});

describe("container credentials", () => {
	const creds = { AccessKeyId: "CA", SecretAccessKey: "CS", Token: "CT", Expiration: "2030-01-01T01:00:00Z" };

	it("asks the ECS agent for a relative URI, and sends the authorization token of the file or the variable", async () => {
		const transport = fake(() => answer(creds));
		const tokenFile = write(home, "token", "  from-file\n");
		const found = await lookup({
			transport,
			signal: new AbortController().signal,
			env: {
				AWS_CONTAINER_CREDENTIALS_RELATIVE_URI: "/v2/credentials/abc",
				AWS_CONTAINER_AUTHORIZATION_TOKEN_FILE: tokenFile,
				AWS_CONTAINER_AUTHORIZATION_TOKEN: "ignored"
			}
		});
		expect(found).toEqual({ keys: { accessKeyId: "CA", secretAccessKey: "CS", sessionToken: "CT" } });
		expect(transport.calls[0].url).toBe("http://169.254.170.2/v2/credentials/abc");
		expect(transport.calls[0].init.headers).toEqual({ authorization: "from-file" });
		expect(transport.calls[0].init.signal).toBeInstanceOf(AbortSignal);
	});

	it("asks a full URI, with the token of the variable or with none", async () => {
		const transport = fake(() => answer(creds));
		await lookup({
			transport,
			env: { AWS_CONTAINER_CREDENTIALS_FULL_URI: "http://localhost:9/creds", AWS_CONTAINER_AUTHORIZATION_TOKEN: "Bearer x" }
		});
		expect(transport.calls[0].url).toBe("http://localhost:9/creds");
		expect(transport.calls[0].init.headers).toEqual({ authorization: "Bearer x" });
		reset();
		await lookup({ transport, env: { AWS_CONTAINER_CREDENTIALS_FULL_URI: "http://localhost:9/creds" } });
		expect(transport.calls[1].init.headers).toEqual({});
	});

	it("fails for an unreadable token file, an unreachable endpoint, a refusal and a reply without keys", async () => {
		const uri = { AWS_CONTAINER_CREDENTIALS_FULL_URI: "http://localhost:9/creds" };
		await expect(lookup({ env: { ...uri, AWS_CONTAINER_AUTHORIZATION_TOKEN_FILE: path.join(home, "missing") } })).rejects.toThrow(
			/cannot read AWS_CONTAINER_AUTHORIZATION_TOKEN_FILE \(ENOENT\)/
		);
		await expect(lookup({ env: uri, transport: fake(() => new Error("refused")) })).rejects.toMatchObject({ status: 502 });
		await expect(lookup({ env: uri, transport: fake(() => answer({}, 403)) })).rejects.toThrow(/refused the request \(HTTP 403\)/);
		await expect(lookup({ env: uri, transport: fake(() => answer({ Token: "x" })) })).rejects.toThrow(/no AccessKeyId and SecretAccessKey/);
	});

	it("is used after a profile that is not there, and before the instance metadata", async () => {
		const transport = fake(() => answer(creds));
		await lookup({ transport, env: { AWS_CONTAINER_CREDENTIALS_RELATIVE_URI: "/x", AWS_EC2_METADATA_DISABLED: "false" } });
		expect(transport.calls.map((call) => call.url)).toEqual(["http://169.254.170.2/x"]);
	});
});

describe("instance metadata", () => {
	const role = "my-role";
	const creds = { Code: "Success", AccessKeyId: "IA", SecretAccessKey: "IS", Token: "IT", Expiration: "2030-01-01T01:00:00Z" };
	const on = { AWS_EC2_METADATA_DISABLED: "false" };
	const service = (extra = {}) =>
		fake((url, init) => {
			if (url.endsWith("/latest/api/token")) return extra.token ?? answer("session-token");
			if (url.endsWith("/security-credentials/")) return extra.list ?? answer(`${role}\nother\n`);
			if (url.endsWith(`/security-credentials/${role}`)) return extra.creds ?? answer(creds);
			throw new Error(`unexpected ${init.method} ${url}`);
		});

	it("gets a session token, the role name and the role's credentials", async () => {
		const transport = service();
		const found = await lookup({ transport, env: on });
		expect(found).toEqual({ keys: { accessKeyId: "IA", secretAccessKey: "IS", sessionToken: "IT" } });
		expect(transport.calls[0]).toMatchObject({ url: "http://169.254.169.254/latest/api/token", init: { method: "PUT" } });
		expect(transport.calls[0].init.headers["x-aws-ec2-metadata-token-ttl-seconds"]).toBe("21600");
		expect(transport.calls[1].init.headers).toEqual({ "x-aws-ec2-metadata-token": "session-token" });
		expect(transport.calls[2].url).toMatch(/security-credentials\/my-role$/);
	});

	it("goes without a token when the service refuses one, and takes the endpoint, role and timeout from the environment", async () => {
		const transport = service({ token: answer("", 405) });
		const found = await lookup({
			transport,
			env: {
				...on,
				AWS_EC2_METADATA_SERVICE_ENDPOINT: "http://imds.local/",
				AWS_EC2_INSTANCE_PROFILE_NAME: role,
				AWS_METADATA_SERVICE_TIMEOUT: "3"
			}
		});
		expect(found.keys.accessKeyId).toBe("IA");
		expect(transport.calls.map((call) => call.url)).toEqual([
			"http://imds.local/latest/api/token",
			`http://imds.local/latest/meta-data/iam/security-credentials/${role}`
		]);
		expect(transport.calls[1].init.headers).toEqual({});
	});

	it("is the end of the chain when disabled, unreachable, without a role or not answering with credentials", async () => {
		expect(await lookup({ env: { AWS_EC2_METADATA_DISABLED: "TRUE" } })).toBeNull();
		expect(await lookup({ transport: fake(() => new Error("no route")), env: on })).toBeNull();
		expect(await lookup({ transport: service({ list: answer("", 404) }), env: on })).toBeNull();
		expect(await lookup({ transport: service({ creds: answer("", 404) }), env: on })).toBeNull();
		expect(await lookup({ transport: service({ creds: answer({ Code: "AssumeRoleUnauthorizedAccess" }) }), env: on })).toBeNull();
		expect(await lookup({ transport: service({ creds: answer("not json") }), env: on })).toBeNull();
	});

	it("reports credentials that arrive without keys", async () => {
		await expect(lookup({ transport: service({ creds: answer({ Code: "Success" }) }), env: on })).rejects.toThrow(
			/instance metadata service have no AccessKeyId/
		);
	});
});

describe("cache", () => {
	const shared = () => write(home, "credentials", "[default]\naws_access_key_id = K\naws_secret_access_key = S\n");
	const process_ = (counter) => (file, args, options, done) => {
		counter.n++;
		done(null, JSON.stringify({ Version: 1, AccessKeyId: `K${counter.n}`, SecretAccessKey: "S", Expiration: "2030-01-01T01:00:00Z" }));
	};
	const withProcess = () => {
		write(home, "config", "[profile p]\ncredential_process = x\n");
		return { AWS_CONFIG_FILE: path.join(home, "config") };
	};

	it("reuses credentials with an expiry until five minutes before it, then asks again", async () => {
		const files = withProcess();
		const counter = { n: 0 };
		let at = Date.parse("2030-01-01T00:00:00Z");
		const ask = () => lookup({ profile: "p", env: files, now: () => at, run: process_(counter) });
		expect((await ask()).keys.accessKeyId).toBe("K1");
		expect((await ask()).keys.accessKeyId).toBe("K1");
		at = Date.parse("2030-01-01T00:56:00Z");
		expect((await ask()).keys.accessKeyId).toBe("K2");
	});

	it("reuses credentials without an expiry for a minute", async () => {
		const files = { AWS_SHARED_CREDENTIALS_FILE: shared() };
		let at = 1_000_000;
		const first = await lookup({ env: files, now: () => at });
		fs.writeFileSync(files.AWS_SHARED_CREDENTIALS_FILE, "[default]\naws_access_key_id = NEW\naws_secret_access_key = S\n");
		expect((await lookup({ env: files, now: () => at })).keys.accessKeyId).toBe(first.keys.accessKeyId);
		at += 120_000;
		expect((await lookup({ env: files, now: () => at })).keys.accessKeyId).toBe("NEW");
	});

	it("shares one lookup between callers that arrive together, and forgets a failure and an empty answer", async () => {
		const files = withProcess();
		const counter = { n: 0 };
		const slow = (file, args, options, done) => setImmediate(() => process_(counter)(file, args, options, done));
		const both = await Promise.all([lookup({ profile: "p", env: files, run: slow }), lookup({ profile: "p", env: files, run: slow })]);
		expect(counter.n).toBe(1);
		expect(both[0]).toBe(both[1]);
		reset();
		const failing = (file, args, options, done) => done(new Error("down"));
		await expect(lookup({ profile: "p", env: files, run: failing })).rejects.toThrow(/credential_process failed/);
		expect((await lookup({ profile: "p", env: files, run: process_(counter) })).keys.accessKeyId).toBe("K2");
		reset();
		expect(await lookup()).toBeNull();
		write(home, "credentials", "[default]\naws_access_key_id = LATE\naws_secret_access_key = S\n");
		expect((await lookup({ env: { AWS_SHARED_CREDENTIALS_FILE: path.join(home, "credentials") } })).keys.accessKeyId).toBe("LATE");
	});

	it("keeps lookups for different profiles apart, and uses the process environment and clock by default", async () => {
		const files = {
			AWS_SHARED_CREDENTIALS_FILE: write(
				home,
				"credentials",
				"[a]\naws_access_key_id = A\naws_secret_access_key = S\n[b]\naws_access_key_id = B\naws_secret_access_key = S\n"
			)
		};
		expect((await lookup({ profile: "a", env: files })).keys.accessKeyId).toBe("A");
		expect((await lookup({ profile: "b", env: files })).keys.accessKeyId).toBe("B");
		const saved = { ...process.env };
		Object.assign(process.env, env(files), { AWS_PROFILE: "a" });
		try {
			expect((await chained({ transport: nothing })).keys.accessKeyId).toBe("A");
		} finally {
			for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
			Object.assign(process.env, saved);
		}
	});
});

const at = () => Date.parse("2030-01-01T00:00:00Z");
const config = (dir, text, shared = "") => {
	write(dir, "config", text);
	write(dir, "credentials", shared);
	return { AWS_CONFIG_FILE: path.join(dir, "config"), AWS_SHARED_CREDENTIALS_FILE: path.join(dir, "credentials") };
};
const stsReply = (key, extra = "") =>
	answer(
		`<AssumeRoleResponse><AssumeRoleResult><Credentials><AccessKeyId>${key}</AccessKeyId><SecretAccessKey>${key}-secret</SecretAccessKey><SessionToken>${key}-token</SessionToken><Expiration>2030-01-01T01:00:00Z</Expiration></Credentials>${extra}</AssumeRoleResult></AssumeRoleResponse>`
	);
const form = (call) => Object.fromEntries(new URLSearchParams(call.init.body));
const base = "[base]\naws_access_key_id = BASEKEY\naws_secret_access_key = basesecret\n";

describe("assume-role profiles", () => {
	const role = "arn:aws:iam::123456789012:role/App";

	it("signs AssumeRole for the service sts with the source profile's keys, and passes the role options", async () => {
		const files = config(
			home,
			`[profile app]\nrole_arn = ${role}\nsource_profile = base\nregion = eu-west-1\nrole_session_name = sess\nexternal_id = ext\nduration_seconds = 1800\n`,
			base
		);
		const transport = fake(() => stsReply("ROLEKEY"));
		const found = await lookup({ profile: "app", env: files, transport, now: at });
		expect(found).toEqual({
			keys: { accessKeyId: "ROLEKEY", secretAccessKey: "ROLEKEY-secret", sessionToken: "ROLEKEY-token" },
			region: "eu-west-1"
		});
		const [call] = transport.calls;
		expect(call.url).toBe("https://sts.eu-west-1.amazonaws.com/");
		expect(call.init.method).toBe("POST");
		expect(call.init.headers.authorization).toContain("Credential=BASEKEY/20300101/eu-west-1/sts/aws4_request");
		expect(form(call)).toEqual({
			Action: "AssumeRole",
			Version: "2011-06-15",
			RoleArn: role,
			RoleSessionName: "sess",
			ExternalId: "ext",
			DurationSeconds: "1800"
		});
	});

	it("names the session after the time when the profile does not, and sends no external id or duration", async () => {
		const files = config(home, `[profile app]\nrole_arn = ${role}\nsource_profile = base\n`, base);
		const transport = fake(() => stsReply("K"));
		await lookup({ profile: "app", env: files, transport, now: at });
		expect(form(transport.calls[0])).toEqual({
			Action: "AssumeRole",
			Version: "2011-06-15",
			RoleArn: role,
			RoleSessionName: `llm-translator-${at()}`
		});
	});

	it("chains roles: the first role's credentials sign the second call", async () => {
		const files = config(
			home,
			`[profile top]\nrole_arn = ${role}Top\nsource_profile = mid\n[profile mid]\nrole_arn = ${role}Mid\nsource_profile = base\n`,
			base
		);
		let n = 0;
		const transport = fake(() => stsReply(`R${++n}`));
		const found = await lookup({ profile: "top", env: files, transport, now: at });
		expect(found.keys.accessKeyId).toBe("R2");
		expect(form(transport.calls[0]).RoleArn).toBe(`${role}Mid`);
		expect(transport.calls[0].init.headers.authorization).toContain("Credential=BASEKEY/");
		expect(transport.calls[1].init.headers.authorization).toContain("Credential=R1/");
		expect(transport.calls[1].init.headers["x-amz-security-token"]).toBe("R1-token");
	});

	it("refuses a loop of source profiles and says which profiles it passes through", async () => {
		const files = config(
			home,
			`[profile a]\nrole_arn = ${role}\nsource_profile = b\n[profile b]\nrole_arn = ${role}\nsource_profile = c\n[profile c]\nrole_arn = ${role}\nsource_profile = a\n[profile self]\nrole_arn = ${role}\nsource_profile = self\n`
		);
		await expect(lookup({ profile: "a", env: files, now: at })).rejects.toThrow(/source_profile makes a loop \(a -> b -> c -> a\)/);
		await expect(lookup({ profile: "self", env: files, now: at })).rejects.toThrow(/loop \(self -> self\)/);
	});

	it("refuses what cannot work: MFA, no source, two sources, a missing source, a source with no credentials, a bad duration", async () => {
		const files = config(
			home,
			[
				`[profile mfa]\nrole_arn = ${role}\nsource_profile = base\nmfa_serial = arn:aws:iam::1:mfa/me`,
				`[profile none]\nrole_arn = ${role}`,
				`[profile both]\nrole_arn = ${role}\nsource_profile = base\ncredential_source = Environment`,
				`[profile ghost]\nrole_arn = ${role}\nsource_profile = nothere`,
				`[profile empty]\nrole_arn = ${role}\nsource_profile = bare\n[profile bare]\nregion = us-east-1`,
				`[profile text]\nrole_arn = ${role}\nsource_profile = base\nduration_seconds = soon`,
				`[profile short]\nrole_arn = ${role}\nsource_profile = base\nduration_seconds = 60`,
				`[profile long]\nrole_arn = ${role}\nsource_profile = base\nduration_seconds = 90000`
			].join("\n"),
			base
		);
		const failing = (profile) => lookup({ profile, env: files, now: at });
		await expect(failing("mfa")).rejects.toThrow(/mfa_serial needs a one-time code, and there is no way to ask for one/);
		await expect(failing("none")).rejects.toThrow(/role_arn needs source_profile or credential_source/);
		await expect(failing("both")).rejects.toThrow(/not both/);
		await expect(failing("ghost")).rejects.toThrow(/source_profile nothere was not found/);
		await expect(failing("empty")).rejects.toThrow(/source_profile bare was not found or names no credentials/);
		for (const profile of ["text", "short", "long"])
			await expect(failing(profile)).rejects.toThrow(/duration_seconds must be a whole number from 900 to 43200/);
	});

	it("takes the source from credential_source: the environment's keys", async () => {
		const files = config(
			home,
			`[profile env]\nrole_arn = ${role}\ncredential_source = Environment\n[profile tok]\nrole_arn = ${role}\ncredential_source = Environment\n`
		);
		const transport = fake(() => stsReply("E"));
		await lookup({ profile: "env", env: { ...files, AWS_ACCESS_KEY_ID: "ENVK", AWS_SECRET_ACCESS_KEY: "envs" }, transport, now: at });
		expect(transport.calls[0].init.headers.authorization).toContain("Credential=ENVK/");
		expect(transport.calls[0].init.headers["x-amz-security-token"]).toBeUndefined();
		reset();
		await lookup({
			profile: "tok",
			env: { ...files, AWS_ACCESS_KEY_ID: "ENVK", AWS_SECRET_ACCESS_KEY: "envs", AWS_SESSION_TOKEN: "envt" },
			transport,
			now: at
		});
		expect(transport.calls[1].init.headers["x-amz-security-token"]).toBe("envt");
		reset();
		await expect(lookup({ profile: "env", env: files, transport, now: at })).rejects.toThrow(
			/Environment needs AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY/
		);
	});

	it("takes the source from credential_source: the instance role and the container role", async () => {
		const files = config(
			home,
			`[profile imds]\nrole_arn = ${role}\ncredential_source = Ec2InstanceMetadata\n[profile ecs]\nrole_arn = ${role}\ncredential_source = EcsContainer\n`
		);
		const imds = fake((url) => {
			if (url.endsWith("/latest/api/token")) return answer("t");
			if (url.endsWith("/security-credentials/")) return answer("r");
			if (url.endsWith("/security-credentials/r"))
				return answer({ Code: "Success", AccessKeyId: "IK", SecretAccessKey: "is", Token: "it", Expiration: "2030-01-01T01:00:00Z" });
			return stsReply("FROMIMDS");
		});
		const on = { AWS_EC2_METADATA_DISABLED: "false" };
		expect((await lookup({ profile: "imds", env: { ...files, ...on }, transport: imds, now: at })).keys.accessKeyId).toBe("FROMIMDS");
		expect(imds.calls.at(-1).init.headers.authorization).toContain("Credential=IK/");
		reset();
		await expect(lookup({ profile: "imds", env: files, now: at })).rejects.toThrow(/found no instance metadata service/);
		reset();
		const ecs = fake((url) =>
			url.startsWith("http://169.254.170.2/")
				? answer({ AccessKeyId: "CK", SecretAccessKey: "cs", Token: "ct", Expiration: "2030-01-01T01:00:00Z" })
				: stsReply("FROMECS")
		);
		expect(
			(await lookup({ profile: "ecs", env: { ...files, AWS_CONTAINER_CREDENTIALS_RELATIVE_URI: "/v2/x" }, transport: ecs, now: at })).keys
				.accessKeyId
		).toBe("FROMECS");
		reset();
		const full = fake((url) =>
			url === "http://localhost:9/c"
				? answer({ AccessKeyId: "CK", SecretAccessKey: "cs", Expiration: "2030-01-01T01:00:00Z" })
				: stsReply("FROMFULL")
		);
		expect(
			(
				await lookup({
					profile: "ecs",
					env: { ...files, AWS_CONTAINER_CREDENTIALS_FULL_URI: "http://localhost:9/c" },
					transport: full,
					now: at
				})
			).keys.accessKeyId
		).toBe("FROMFULL");
		reset();
		await expect(lookup({ profile: "ecs", env: files, now: at })).rejects.toThrow(/EcsContainer needs AWS_CONTAINER_CREDENTIALS/);
	});

	it("refuses an unknown credential_source", async () => {
		const files = config(home, `[profile odd]\nrole_arn = ${role}\ncredential_source = Magic\n`);
		await expect(lookup({ profile: "odd", env: files, now: at })).rejects.toThrow(
			/credential_source Magic is not one of Environment, Ec2InstanceMetadata, EcsContainer/
		);
	});

	it("reports an STS that is unreachable, refuses, or answers without credentials", async () => {
		const files = config(home, `[profile app]\nrole_arn = ${role}\nsource_profile = base\n`, base);
		const run = (transport) => lookup({ profile: "app", env: files, transport, now: at });
		await expect(run(fake(() => new Error("offline")))).rejects.toMatchObject({
			status: 502,
			message: expect.stringContaining("AssumeRole request failed: offline")
		});
		reset();
		await expect(
			run(fake(() => answer("<ErrorResponse><Error><Code>AccessDenied</Code><Message>not allowed</Message></Error></ErrorResponse>", 403)))
		).rejects.toThrow(/refused AssumeRole \(HTTP 403\): not allowed/);
		reset();
		await expect(run(fake(() => answer("", 500)))).rejects.toThrow(/refused AssumeRole \(HTTP 500\)$/);
		reset();
		await expect(run(fake(() => answer("<AssumeRoleResponse/>")))).rejects.toThrow(/no AccessKeyId and SecretAccessKey/);
	});

	it("picks the STS endpoint: regional, legacy, China, the override, and the region from the environment", async () => {
		const files = config(
			home,
			[
				`[profile reg]\nrole_arn = ${role}\nsource_profile = base\nregion = ap-south-1`,
				`[profile old]\nrole_arn = ${role}\nsource_profile = base\nregion = ap-south-1\nsts_regional_endpoints = legacy`,
				`[profile cn]\nrole_arn = ${role}\nsource_profile = base\nregion = cn-north-1\nsts_regional_endpoints = legacy`,
				`[profile bare]\nrole_arn = ${role}\nsource_profile = base`
			].join("\n"),
			base
		);
		const urlOf = async (profile, extra = {}) => {
			reset();
			const transport = fake(() => stsReply("K"));
			await lookup({ profile, env: { ...files, ...extra }, transport, now: at });
			return [transport.calls[0].url, transport.calls[0].init.headers.authorization.match(/\/(\d{8})\/([^/]+)\/sts\//).slice(2)[0]];
		};
		expect(await urlOf("reg")).toEqual(["https://sts.ap-south-1.amazonaws.com/", "ap-south-1"]);
		expect(await urlOf("old")).toEqual(["https://sts.amazonaws.com/", "us-east-1"]);
		expect(await urlOf("cn")).toEqual(["https://sts.cn-north-1.amazonaws.com.cn/", "cn-north-1"]);
		expect(await urlOf("bare", { AWS_STS_REGIONAL_ENDPOINTS: "LEGACY" })).toEqual(["https://sts.amazonaws.com/", "us-east-1"]);
		expect(await urlOf("bare", { AWS_REGION: "eu-north-1" })).toEqual(["https://sts.eu-north-1.amazonaws.com/", "eu-north-1"]);
		expect(await urlOf("bare", { AWS_DEFAULT_REGION: "eu-north-2" })).toEqual(["https://sts.eu-north-2.amazonaws.com/", "eu-north-2"]);
		expect(await urlOf("bare")).toEqual(["https://sts.us-east-1.amazonaws.com/", "us-east-1"]);
		expect((await urlOf("reg", { AWS_ENDPOINT_URL_STS: "http://sts.local:9//" }))[0]).toBe("http://sts.local:9/");
	});

	it("caches the role's credentials until five minutes before they expire", async () => {
		const files = config(home, `[profile app]\nrole_arn = ${role}\nsource_profile = base\n`, base);
		const transport = fake(() => stsReply("K"));
		let now = at();
		const ask = () => lookup({ profile: "app", env: files, transport, now: () => now });
		await ask();
		await ask();
		expect(transport.calls).toHaveLength(1);
		now = Date.parse("2030-01-01T00:56:00Z");
		await ask();
		expect(transport.calls).toHaveLength(2);
	});
});

describe("web identity", () => {
	const arn = "arn:aws:iam::123456789012:role/Pod";
	const tokenFile = () => write(home, "token", " jwt-1\n");

	it("calls AssumeRoleWithWebIdentity, unsigned, for a profile with web_identity_token_file and role_arn", async () => {
		const files = config(
			home,
			`[profile pod]\nweb_identity_token_file = ${tokenFile()}\nrole_arn = ${arn}\nrole_session_name = s1\nduration_seconds = 3600\nregion = us-west-2\n`
		);
		const transport = fake(() => stsReply("WK"));
		const found = await lookup({ profile: "pod", env: files, transport, now: at });
		expect(found).toEqual({ keys: { accessKeyId: "WK", secretAccessKey: "WK-secret", sessionToken: "WK-token" }, region: "us-west-2" });
		const [call] = transport.calls;
		expect(call.url).toBe("https://sts.us-west-2.amazonaws.com/");
		expect(call.init.headers.authorization).toBeUndefined();
		expect(form(call)).toEqual({
			Action: "AssumeRoleWithWebIdentity",
			Version: "2011-06-15",
			RoleArn: arn,
			RoleSessionName: "s1",
			WebIdentityToken: "jwt-1",
			DurationSeconds: "3600"
		});
	});

	it("reads the token again on every lookup, and fails for a missing role_arn or an unreadable file", async () => {
		const bad = config(
			home,
			`[profile a]\nweb_identity_token_file = ${path.join(home, "none")}\nrole_arn = ${arn}\n[profile b]\nweb_identity_token_file = ${tokenFile()}\n`
		);
		await expect(lookup({ profile: "a", env: bad, now: at })).rejects.toThrow(/cannot read the token file .*none \(ENOENT\)/);
		await expect(lookup({ profile: "b", env: bad, now: at })).rejects.toThrow(/web_identity_token_file needs role_arn/);
	});

	it("uses the environment's AWS_WEB_IDENTITY_TOKEN_FILE and AWS_ROLE_ARN, with AWS_ROLE_SESSION_NAME or a made-up name", async () => {
		const transport = fake(() => stsReply("EK"));
		const env = { AWS_WEB_IDENTITY_TOKEN_FILE: tokenFile(), AWS_ROLE_ARN: arn, AWS_REGION: "eu-west-2" };
		const found = await lookup({ env: { ...env, AWS_ROLE_SESSION_NAME: "pod-1" }, transport, now: at });
		expect(found.keys.accessKeyId).toBe("EK");
		expect(transport.calls[0].url).toBe("https://sts.eu-west-2.amazonaws.com/");
		expect(form(transport.calls[0]).RoleSessionName).toBe("pod-1");
		reset();
		await lookup({ env, transport, now: at });
		expect(form(transport.calls[1]).RoleSessionName).toBe(`llm-translator-${at()}`);
	});

	it("comes after the profile and before the container role, and a named profile ignores it", async () => {
		const files = config(home, "", "[default]\naws_access_key_id = PROFILEKEY\naws_secret_access_key = s\n");
		const env = { AWS_WEB_IDENTITY_TOKEN_FILE: tokenFile(), AWS_ROLE_ARN: arn, AWS_CONTAINER_CREDENTIALS_FULL_URI: "http://localhost:9/c" };
		const transport = fake((url) =>
			url.startsWith("https://sts.")
				? stsReply("WEB")
				: answer({ AccessKeyId: "CK", SecretAccessKey: "cs", Expiration: "2030-01-01T01:00:00Z" })
		);
		expect((await lookup({ env: { ...files, ...env }, transport, now: at })).keys.accessKeyId).toBe("PROFILEKEY");
		reset();
		expect(
			(await lookup({ env: { ...env, AWS_SHARED_CREDENTIALS_FILE: path.join(home, "none") }, transport, now: at })).keys.accessKeyId
		).toBe("WEB");
		expect(transport.calls.map((call) => call.url)).toEqual(["https://sts.us-east-1.amazonaws.com/"]);
		reset();
		await expect(lookup({ profile: "ghost", env: { ...files, ...env }, transport, now: at })).rejects.toThrow(/AWS profile ghost/);
	});
});

describe("SSO refresh", () => {
	const key = (name) => sha1(name);
	const cache = (name, fields) => write(home, `.aws/sso/cache/${key(name)}.json`, JSON.stringify(fields));
	const files = (extra = "") =>
		config(
			home,
			`[profile sso]\nsso_session = work\nsso_account_id = 1\nsso_role_name = R\n[profile old]\nsso_start_url = https://old\nsso_region = us-east-1\nsso_account_id = 1\nsso_role_name = R\n[sso-session work]\nsso_start_url = https://x.awsapps.com/start\nsso_region = us-east-1\n${extra}`
		);
	const stale = {
		accessToken: "OLD",
		expiresAt: "2029-12-31T00:00:00Z",
		refreshToken: "R1",
		clientId: "cid",
		clientSecret: "csec",
		registrationExpiresAt: "2031-01-01T00:00:00Z"
	};
	const server = (reply) =>
		fake((url, init) => {
			if (url.startsWith("https://oidc.")) return typeof reply === "function" ? reply(url, init) : reply;
			return answer({
				roleCredentials: { accessKeyId: "SA", secretAccessKey: "SS", sessionToken: "ST", expiration: Date.parse("2030-01-01T06:00:00Z") }
			});
		});
	const renewed = () => answer({ accessToken: "NEW", expiresIn: 28800, tokenType: "Bearer", refreshToken: "R2" });
	const cacheFile = () => path.join(home, ".aws", "sso", "cache", `${key("work")}.json`);

	it("refreshes an expired access token with the refresh_token grant, uses the new one and writes the cache file back", async () => {
		cache("work", { ...stale, startUrl: "https://x.awsapps.com/start", region: "us-east-1" });
		const transport = server(renewed);
		const found = await lookup({ profile: "sso", env: files(), transport, now: at });
		expect(found.keys.accessKeyId).toBe("SA");
		const [refresh, portal] = transport.calls;
		expect(refresh.url).toBe("https://oidc.us-east-1.amazonaws.com/token");
		expect(refresh.init.method).toBe("POST");
		expect(refresh.init.headers).toEqual({ "content-type": "application/json" });
		expect(JSON.parse(refresh.init.body)).toEqual({
			clientId: "cid",
			clientSecret: "csec",
			grantType: "refresh_token",
			refreshToken: "R1"
		});
		expect(portal.init.headers["x-amz-sso_bearer_token"]).toBe("NEW");
		expect(JSON.parse(fs.readFileSync(cacheFile(), "utf8"))).toEqual({
			...stale,
			startUrl: "https://x.awsapps.com/start",
			region: "us-east-1",
			accessToken: "NEW",
			expiresAt: "2030-01-01T08:00:00Z",
			refreshToken: "R2"
		});
	});

	it("keeps the old refresh token when the service sends none, refreshes a cache without an access token, and uses the China host", async () => {
		const { accessToken: _, ...bare } = stale;
		cache("work", bare);
		const transport = server(answer({ accessToken: "N2", expiresIn: 60, refreshToken: "" }));
		await lookup({ profile: "sso", env: files(), transport, now: at });
		const saved = JSON.parse(fs.readFileSync(cacheFile(), "utf8"));
		expect(saved).toMatchObject({ accessToken: "N2", refreshToken: "R1", expiresAt: "2030-01-01T00:01:00Z" });
		reset();
		const cn = config(
			home,
			"[profile cn]\nsso_session = c\nsso_account_id = 1\nsso_role_name = R\n[sso-session c]\nsso_start_url = https://c\nsso_region = cn-north-1\n"
		);
		cache("c", stale);
		const cnTransport = server(renewed);
		await lookup({ profile: "cn", env: cn, transport: cnTransport, now: at });
		expect(cnTransport.calls[0].url).toBe("https://oidc.cn-north-1.amazonaws.com.cn/token");
	});

	it("does not refresh a token that is still good", async () => {
		cache("work", { ...stale, accessToken: "LIVE", expiresAt: "2030-01-01T05:00:00Z" });
		const transport = server(renewed);
		await lookup({ profile: "sso", env: files(), transport, now: at });
		expect(transport.calls).toHaveLength(1);
		expect(transport.calls[0].init.headers["x-amz-sso_bearer_token"]).toBe("LIVE");
	});

	it("keeps the aws sso login hint when the login cannot be refreshed", async () => {
		const expired = /the SSO login has expired; run `aws sso login --profile (sso|old)`/;
		const refusal = (profile, fields, env = files()) =>
			lookup({ profile, env, transport: server(renewed), now: at, ...{} }).then(
				() => null,
				(error) => error
			);
		cache("work", { ...stale, refreshToken: undefined });
		expect((await refusal("sso", {})).message).toMatch(expired);
		cache("work", { ...stale, clientId: undefined });
		expect((await refusal("sso", {})).message).toMatch(expired);
		cache("work", { ...stale, clientSecret: undefined });
		expect((await refusal("sso", {})).message).toMatch(expired);
		cache("work", { ...stale, registrationExpiresAt: "2029-01-01T00:00:00Z" });
		expect((await refusal("sso", {})).message).toMatch(expired);
		// A legacy profile has no session, so no client registration to refresh with.
		cache("https://old", stale);
		expect((await refusal("old", {})).message).toMatch(expired);
	});

	it("reports a refusal, a reply without a token or expiry, an unreachable service and a cache that cannot be written, each with the hint", async () => {
		cache("work", stale);
		const failing = (reply) => lookup({ profile: "sso", env: files(), transport: server(reply), now: at });
		await expect(failing(answer({ error: "invalid_grant" }, 400))).rejects.toThrow(
			/refused to refresh the login of profile sso \(HTTP 400\); run `aws sso login --profile sso`/
		);
		await expect(failing(answer({ expiresIn: 60 }))).rejects.toThrow(/refused to refresh/);
		await expect(failing(answer({ accessToken: "x" }))).rejects.toThrow(/refused to refresh/);
		await expect(failing(answer("not json"))).rejects.toThrow(/refused to refresh/);
		await expect(failing(new Error("offline"))).rejects.toMatchObject({
			status: 502,
			message: expect.stringContaining("token refresh failed: offline; run `aws sso login --profile sso`")
		});
		// The cache file is replaced by a folder while the refresh is in flight, so the new token cannot be saved.
		const jam = () => {
			fs.rmSync(cacheFile());
			fs.mkdirSync(cacheFile());
			return renewed();
		};
		await expect(failing(jam)).rejects.toThrow(/was refreshed but the cache file cannot be written \(EISDIR\)/);
	});
});
