/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /tests/driver/bedrock-gaps.test.vitest.mjs
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
 * @fileoverview Amazon Bedrock: the pieces added after the first driver, each through a translator and a local stand-in for the runtime: cache points, signed reasoning, `response_format`, the AWS credential chain, `anthropic-beta`, decoded stream capture and `CountTokens`.
 */
import fs from "node:fs";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { closeAll, collect, make } from "../helpers/translator.mjs";
import { bedrock, keys, reply, stream } from "../helpers/bedrock.mjs";
import { chunk, event } from "../helpers/eventstream.mjs";
import { reset } from "../../src/lib/aws-credentials.mjs";

const CLAUDE = "anthropic.claude-sonnet-4-5-20250929-v1:0";
const CLAUDE_PATH = "/model/anthropic.claude-sonnet-4-5-20250929-v1%3A0";
const NOVA = "amazon.nova-pro-v1:0";
const NOVA_PATH = "/model/amazon.nova-pro-v1%3A0";
const user = [{ role: "user", content: "hi" }];
const eph = { type: "ephemeral" };
const isolated = {
	AWS_CONFIG_FILE: "/nonexistent/aws/config",
	AWS_SHARED_CREDENTIALS_FILE: "/nonexistent/aws/credentials",
	AWS_EC2_METADATA_DISABLED: "true"
};
const touched = [
	...Object.keys(isolated),
	"AWS_PROFILE",
	"AWS_ACCESS_KEY_ID",
	"AWS_SECRET_ACCESS_KEY",
	"AWS_REGION",
	"AWS_EC2_METADATA_SERVICE_ENDPOINT",
	"AWS_CONTAINER_CREDENTIALS_FULL_URI",
	"AWS_CONTAINER_AUTHORIZATION_TOKEN"
];
const dirs = [];

let aws;
beforeAll(async () => {
	aws = await bedrock("us-east-1");
	Object.assign(process.env, isolated);
});
afterAll(async () => {
	await closeAll();
	await aws.close();
	for (const name of touched) delete process.env[name];
});
afterEach(() => {
	for (const name of touched) delete process.env[name];
	Object.assign(process.env, isolated);
	reset();
	while (dirs.length > 0) fs.rmSync(dirs.pop(), { recursive: true, force: true });
});

const translator = ({ front = "anthropic", config, ...upstream } = {}) =>
	make({ front, upstreams: [{ url: aws.url, backend: "bedrock", region: "us-east-1", ...keys, ...upstream }], detect: false, ...config });
const converseReply = (content, stopReason = "end_turn") => ({
	output: { message: { role: "assistant", content } },
	stopReason,
	usage: { inputTokens: 12, outputTokens: 5, totalTokens: 17 }
});
const claudeMessage = {
	id: "msg_01",
	type: "message",
	role: "assistant",
	model: "claude-sonnet-4-5",
	content: [{ type: "text", text: "Hello" }],
	stop_reason: "end_turn",
	stop_sequence: null,
	usage: { input_tokens: 1, output_tokens: 1 }
};
const scratch = () => {
	fs.mkdirSync(path.join(process.cwd(), "tmp"), { recursive: true });
	const dir = fs.mkdtempSync(path.join(process.cwd(), "tmp", "bedrock-gaps-"));
	dirs.push(dir);
	return dir;
};

describe("cache points over Converse", () => {
	it("sends cache_control as cachePoint blocks to a Converse model", async () => {
		const api = await translator();
		aws.use((_call, res) => reply(res, 200, converseReply([{ text: "ok" }])));
		await api.send({
			model: NOVA,
			max_tokens: 20,
			system: [{ type: "text", text: "rules", cache_control: eph }],
			messages: [{ role: "user", content: [{ type: "text", text: "long context", cache_control: { type: "ephemeral", ttl: "1h" } }] }]
		});
		const { body, url } = aws.seen[0];
		expect(url).toBe(`${NOVA_PATH}/converse`);
		expect(body.system).toEqual([{ text: "rules" }, { cachePoint: { type: "default" } }]);
		expect(body.messages[0].content).toEqual([{ text: "long context" }, { cachePoint: { type: "default", ttl: "1h" } }]);
	});

	it("leaves them out when the bedrock.cache setting is false", async () => {
		const api = await translator({ config: { settings: { bedrock: { cache: false } } } });
		aws.use((_call, res) => reply(res, 200, converseReply([{ text: "ok" }])));
		await api.send({ model: NOVA, max_tokens: 20, system: [{ type: "text", text: "rules", cache_control: eph }], messages: user });
		expect(JSON.stringify(aws.seen[0].body)).not.toContain("cachePoint");
	});
});

describe("signed reasoning over Converse", () => {
	it("returns the signature in the thinking block and sends it back with the next turn", async () => {
		const api = await translator();
		aws.use((_call, res) =>
			reply(
				res,
				200,
				converseReply([{ reasoningContent: { reasoningText: { text: "let me think", signature: "sig-A" } } }, { text: "done" }])
			)
		);
		const thinking = { type: "enabled", budget_tokens: 1024 };
		const first = await api.send({ model: NOVA, max_tokens: 2000, thinking, messages: user });
		expect(first.body.content[0]).toMatchObject({ type: "thinking", thinking: "let me think" });
		aws.use((_call, res) => reply(res, 200, converseReply([{ text: "fine" }])));
		await api.send({
			model: NOVA,
			max_tokens: 2000,
			thinking,
			messages: [...user, { role: "assistant", content: first.body.content }, { role: "user", content: "go on" }]
		});
		expect(aws.seen[0].body.messages[1].content[0]).toEqual({
			reasoningContent: { reasoningText: { text: "let me think", signature: "sig-A" } }
		});
		expect(aws.seen[0].body.additionalModelRequestFields.thinking).toEqual({ type: "enabled", budget_tokens: 1024 });
	});

	it("streams the signature too, and the OpenAI front gets reasoning_details", async () => {
		const api = await translator({ front: "openai" });
		aws.use((_call, res) =>
			stream(res, [
				event("messageStart", { role: "assistant" }),
				event("contentBlockDelta", { contentBlockIndex: 0, delta: { reasoningContent: { text: "hmm" } } }),
				event("contentBlockDelta", { contentBlockIndex: 0, delta: { reasoningContent: { signature: "sig-B" } } }),
				event("contentBlockDelta", { contentBlockIndex: 1, delta: { text: "ok" } }),
				event("messageStop", { stopReason: "end_turn" }),
				event("metadata", { usage: { inputTokens: 1, outputTokens: 1 } })
			])
		);
		const out = await api.send({ model: NOVA, stream: true, messages: user });
		const details = (await collect(out.stream)).flatMap((entry) => entry.data?.choices?.[0]?.delta?.reasoning_details ?? []);
		expect(details.find((item) => item.signature === "sig-B")).toMatchObject({ type: "reasoning.text", text: "" });
		expect(details.find((item) => item.text === "hmm")).toBeDefined();
	});

	it("does not warn about missing reasoning on a plain tool turn", async () => {
		const seen = [];
		const api = await translator({ config: { onEvent: (entry) => seen.push(entry) } });
		aws.use((_call, res) => reply(res, 200, converseReply([{ text: "ok" }])));
		await api.send({
			model: NOVA,
			max_tokens: 20,
			tools: [{ name: "R", input_schema: { type: "object" } }],
			messages: [
				...user,
				{ role: "assistant", content: [{ type: "tool_use", id: "t", name: "R", input: {} }] },
				{ role: "user", content: [{ type: "tool_result", tool_use_id: "t", content: "x" }] }
			]
		});
		expect(seen.filter((entry) => entry.kind === "reasoning")).toEqual([]);
	});
});

describe("response_format over Converse", () => {
	const schema = { type: "object", properties: { answer: { type: "string" } }, required: ["answer"] };
	const answered = converseReply([{ toolUse: { toolUseId: "t1", name: "json_response", input: { answer: "42" } } }], "tool_use");

	it("OpenAI front: a forced tool carries the schema and its call is the content", async () => {
		const api = await translator({ front: "openai" });
		aws.use((_call, res) => reply(res, 200, answered));
		const out = await api.send({
			model: NOVA,
			messages: user,
			response_format: { type: "json_schema", json_schema: { name: "a", schema } }
		});
		const { toolConfig } = aws.seen[0].body;
		expect(toolConfig.toolChoice).toEqual({ tool: { name: "json_response" } });
		expect(toolConfig.tools[0].toolSpec.inputSchema.json).toEqual(schema);
		expect(out.body.choices[0]).toMatchObject({ message: { content: '{"answer":"42"}' }, finish_reason: "stop" });
	});

	it("Anthropic front: output_config.format becomes the tool, the reply a text block, and a stream text deltas", async () => {
		const api = await translator();
		aws.use((_call, res) => reply(res, 200, answered));
		const body = { model: NOVA, max_tokens: 50, messages: user, output_config: { format: { type: "json_schema", schema } } };
		const out = await api.send(body);
		expect(out.body.content).toEqual([{ type: "text", text: '{"answer":"42"}' }]);
		expect(out.body.stop_reason).toBe("end_turn");
		aws.use((_call, res) =>
			stream(res, [
				event("messageStart", { role: "assistant" }),
				event("contentBlockStart", { contentBlockIndex: 0, start: { toolUse: { toolUseId: "t", name: "json_response" } } }),
				event("contentBlockDelta", { contentBlockIndex: 0, delta: { toolUse: { input: '{"answer":' } } }),
				event("contentBlockDelta", { contentBlockIndex: 0, delta: { toolUse: { input: '"7"}' } } }),
				event("messageStop", { stopReason: "tool_use" }),
				event("metadata", { usage: { inputTokens: 1, outputTokens: 1 } })
			])
		);
		const streamed = await api.send({ ...body, stream: true });
		const text = (await collect(streamed.stream)).map((entry) => entry.data.delta?.text ?? "").join("");
		expect(text).toBe('{"answer":"7"}');
	});
});

describe("the AWS credential chain", () => {
	const okReply = (_call, res) => reply(res, 200, claudeMessage);
	const body = { model: CLAUDE, max_tokens: 8, messages: user };
	const send = async (upstream = {}) => {
		const api = await make({ upstreams: [{ url: aws.url, backend: "bedrock", region: "us-east-1", ...upstream }], detect: false });
		aws.use(okReply);
		await api.send(body);
		return aws.seen.at(-1);
	};
	const credentials = (text) => {
		const file = path.join(scratch(), "credentials");
		fs.writeFileSync(file, text);
		process.env.AWS_SHARED_CREDENTIALS_FILE = file;
	};
	const profile = (name, key = keys.accessKeyId) =>
		`[${name}]\naws_access_key_id = ${key}\naws_secret_access_key = ${keys.secretAccessKey}\n`;

	it("signs with the profile setting of the upstream", async () => {
		credentials(profile("work"));
		expect((await send({ profile: "work" })).auth).toBe("signature ok");
	});

	it("signs with the AWS_PROFILE profile, and with the default profile", async () => {
		credentials(profile("other"));
		process.env.AWS_PROFILE = "other";
		expect((await send()).auth).toBe("signature ok");
		delete process.env.AWS_PROFILE;
		reset();
		credentials(profile("default"));
		expect((await send()).auth).toBe("signature ok");
	});

	it("takes the keys of an ECS task role from the container credentials endpoint", async () => {
		process.env.AWS_CONTAINER_CREDENTIALS_FULL_URI = `${aws.url}/task-role`;
		process.env.AWS_CONTAINER_AUTHORIZATION_TOKEN = "task-token";
		const api = await make({ upstreams: [{ url: aws.url, backend: "bedrock", region: "us-east-1" }], detect: false });
		aws.use((call, res) =>
			call.url === "/task-role"
				? reply(res, 200, { AccessKeyId: keys.accessKeyId, SecretAccessKey: keys.secretAccessKey, Expiration: "2099-01-01T00:00:00Z" })
				: reply(res, 200, claudeMessage)
		);
		await api.send(body);
		expect(aws.seen[0]).toMatchObject({ url: "/task-role", headers: { authorization: "task-token" } });
		expect(aws.seen[1].auth).toBe("signature ok");
	});

	it("takes the keys of an EC2 instance role from the metadata service", async () => {
		process.env.AWS_EC2_METADATA_DISABLED = "false";
		process.env.AWS_EC2_METADATA_SERVICE_ENDPOINT = aws.url;
		const api = await make({ upstreams: [{ url: aws.url, backend: "bedrock", region: "us-east-1" }], detect: false });
		aws.use((call, res) => {
			if (call.url === "/latest/api/token") return res.end("imds-token");
			if (call.url.endsWith("/security-credentials/")) return res.end("role-1");
			if (call.url.endsWith("/security-credentials/role-1")) {
				return reply(res, 200, {
					Code: "Success",
					AccessKeyId: keys.accessKeyId,
					SecretAccessKey: keys.secretAccessKey,
					Token: "role-session",
					Expiration: "2099-01-01T00:00:00Z"
				});
			}
			return reply(res, 200, claudeMessage);
		});
		await api.send(body);
		expect(aws.seen[1].headers["x-aws-ec2-metadata-token"]).toBe("imds-token");
		const call = aws.seen.at(-1);
		expect(call.auth).toBe("signature ok");
		expect(call.headers["x-amz-security-token"]).toBe("role-session");
	});

	it("still prefers the keys of the upstream and the environment to any of that", async () => {
		credentials(profile("default", "SHAREDKEY"));
		expect((await send({ ...keys })).auth).toBe("signature ok");
		Object.assign(process.env, { AWS_ACCESS_KEY_ID: keys.accessKeyId, AWS_SECRET_ACCESS_KEY: keys.secretAccessKey });
		expect((await send()).auth).toBe("signature ok");
	});

	it("the model list uses the chain too", async () => {
		credentials(profile("work"));
		const api = await make({
			front: "openai",
			upstreams: [{ url: aws.url, backend: "bedrock", region: "us-east-1", profile: "work" }],
			detect: false
		});
		aws.use((_call, res) => reply(res, 200, { modelSummaries: [{ modelId: NOVA }] }));
		expect((await api.model.list()).data.map((entry) => entry.id)).toEqual([NOVA]);
		expect(aws.seen[0].auth).toBe("signature ok");
	});
});

describe("anthropic-beta over InvokeModel", () => {
	it("sends the client's beta header as anthropic_beta in the body, merged with the body's own, and not as a header", async () => {
		const api = await translator();
		aws.use((_call, res) => reply(res, 200, claudeMessage));
		await api.send(
			{ model: CLAUDE, max_tokens: 8, anthropic_beta: ["b", "c"], messages: user },
			{ clientHeaders: { "anthropic-beta": "a, b", "anthropic-version": "2023-06-01", "x-claude-code-session": "s" } }
		);
		const call = aws.seen[0];
		expect(call.body.anthropic_beta).toEqual(["b", "c", "a"]);
		expect(call.body.anthropic_version).toBe("bedrock-2023-05-31");
		expect(call.headers["anthropic-beta"]).toBeUndefined();
		expect(call.headers["anthropic-version"]).toBeUndefined();
		expect(call.auth).toBe("signature ok");
	});

	it("adds nothing without the header, and the request() leaf reads a repeated header", async () => {
		const api = await translator();
		aws.use((_call, res) => reply(res, 200, claudeMessage));
		await api.send({ model: CLAUDE, max_tokens: 8, messages: user });
		expect(aws.seen[0].body.anthropic_beta).toBeUndefined();
		const { request } = api.driver.bedrock;
		const input = { max_tokens: 1, anthropic_beta: "solo" };
		const messages = { protocol: "anthropic.messages" };
		expect(request(input, { ...messages, clientHeaders: { "anthropic-beta": ["x,y", " ", "y"] } }).anthropic_beta).toEqual([
			"solo",
			"x",
			"y"
		]);
		expect(request({ max_tokens: 1 }, { ...messages, clientHeaders: {} }).anthropic_beta).toBeUndefined();
		expect(request({ max_tokens: 1 }, { ...messages, clientHeaders: { "anthropic-beta": undefined } }).anthropic_beta).toBeUndefined();
		// Converse has no such field.
		expect(request(input, { protocol: "bedrock.converse", clientHeaders: { "anthropic-beta": "x" } }).anthropic_beta).toBe("solo");
	});
});

describe("capture of a Bedrock stream", () => {
	it("stores the decoded events, not the binary frames, for Converse and for InvokeModel", async () => {
		const records = [];
		const api = await translator({ config: { capture: (entry) => records.push(entry) } });
		aws.use((_call, res) =>
			stream(
				res,
				[
					event("messageStart", { role: "assistant" }),
					event("contentBlockDelta", { contentBlockIndex: 0, delta: { text: "hi" } }),
					event("messageStop", { stopReason: "end_turn" }),
					event("metadata", { usage: { inputTokens: 1, outputTokens: 1 } })
				],
				9
			)
		);
		await collect((await api.send({ model: NOVA, max_tokens: 8, stream: true, messages: user })).stream);
		expect(records.at(-1).response.raw).toBe(
			[
				'event: messageStart\ndata: {"role":"assistant"}\n\n',
				'event: contentBlockDelta\ndata: {"contentBlockIndex":0,"delta":{"text":"hi"}}\n\n',
				'event: messageStop\ndata: {"stopReason":"end_turn"}\n\n',
				'event: metadata\ndata: {"usage":{"inputTokens":1,"outputTokens":1}}\n\n'
			].join("")
		);
		aws.use((_call, res) =>
			stream(res, [
				chunk({ type: "message_start", message: { ...claudeMessage, content: [] } }),
				chunk({ type: "message_stop", "amazon-bedrock-invocationMetrics": { inputTokenCount: 1 } })
			])
		);
		await collect((await api.send({ model: CLAUDE, max_tokens: 8, stream: true, messages: user })).stream);
		expect(records.at(-1).response.raw).toMatch(/^event: message_start\ndata: \{"type":"message_start"/);
		expect(records.at(-1).response.raw).toContain('event: message_stop\ndata: {"type":"message_stop"}\n\n');
		expect(records.at(-1).response.raw).not.toContain("invocationMetrics");
	});

	it("records the error of a stream that cannot be read, once", async () => {
		const records = [];
		const api = await translator({ config: { capture: (entry) => records.push(entry) } });
		const bad = Buffer.from(event("messageStart", { role: "assistant" }));
		bad[bad.length - 6] ^= 0xff;
		aws.use((_call, res) => stream(res, [bad, event("messageStop", { stopReason: "end_turn" })], 1000));
		await collect((await api.send({ model: NOVA, max_tokens: 8, stream: true, messages: user })).stream);
		const raw = records.at(-1).response.raw;
		expect(raw).toMatch(/^event: error\ndata: .*bad message checksum/);
		expect(raw.match(/event: error/g)).toHaveLength(1);
	});
});

describe("CountTokens", () => {
	it("counts a Claude request as InvokeModel input, with the body base64 encoded, signed", async () => {
		const api = await translator();
		aws.use((_call, res) => reply(res, 200, { inputTokens: 42 }));
		const request = { model: CLAUDE, max_tokens: 8, system: "be brief", messages: user };
		expect(await api.token.count(request)).toEqual({ input_tokens: 42 });
		const call = aws.seen[0];
		expect(call).toMatchObject({ method: "POST", url: `${CLAUDE_PATH}/count-tokens`, auth: "signature ok" });
		expect(JSON.parse(Buffer.from(call.body.input.invokeModel.body, "base64"))).toEqual({
			anthropic_version: "bedrock-2023-05-31",
			max_tokens: 8,
			system: "be brief",
			messages: user
		});
	});

	it("counts a Converse request as Converse input, without the sampling fields", async () => {
		const api = await translator();
		aws.use((_call, res) => reply(res, 200, { inputTokens: 7 }));
		const count = await api.token.count({
			model: NOVA,
			max_tokens: 8,
			temperature: 0.5,
			system: "be brief",
			tools: [{ name: "R", input_schema: { type: "object" } }],
			messages: user
		});
		expect(count).toEqual({ input_tokens: 7 });
		const { url, body } = aws.seen[0];
		expect(url).toBe(`${NOVA_PATH}/count-tokens`);
		expect(Object.keys(body.input.converse).sort()).toEqual(["messages", "system", "toolConfig"]);
	});

	it("estimates when Bedrock refuses, answers without a count, or there is no credential", async () => {
		const api = await translator();
		const request = { model: CLAUDE, max_tokens: 8, messages: [{ role: "user", content: "x".repeat(400) }] };
		aws.use((_call, res) => reply(res, 403, { message: "denied" }));
		expect((await api.token.count(request)).input_tokens).toBeGreaterThan(90);
		aws.use((_call, res) => reply(res, 200, { inputTokens: "many" }));
		expect((await api.token.count(request)).input_tokens).toBeGreaterThan(90);
		const noKey = await make({ upstreams: [{ url: aws.url, backend: "bedrock", region: "us-east-1" }], detect: false });
		aws.use((_call, res) => reply(res, 200, { inputTokens: 1 }));
		expect((await noKey.token.count(request)).input_tokens).toBeGreaterThan(90);
		expect(aws.seen).toEqual([]);
	});
});
