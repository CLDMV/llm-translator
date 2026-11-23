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
