/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /tests/lib/vertex.test.vitest.mjs
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
 * @fileoverview Vertex AI layout: hosts, regions, projects, paths and the request body.
 */
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import * as google from "../../src/lib/google-auth.mjs";
import * as vertex from "../../src/lib/vertex.mjs";
import { authorizedUser, serviceAccount } from "../helpers/google.mjs";

afterEach(() => google.reset());

const endpoint = (extra = {}) => ({
	name: "v",
	url: "https://us-east5-aiplatform.googleapis.com",
	...extra,
	vertex: { project: "p1", ...extra.vertex }
});

describe("host and region", () => {
	it("builds the regional and the global host and reads the region back from a URL", () => {
		expect(vertex.host("us-east5")).toBe("us-east5-aiplatform.googleapis.com");
		expect(vertex.host("europe-west1")).toBe("europe-west1-aiplatform.googleapis.com");
		expect(vertex.host("global")).toBe("aiplatform.googleapis.com");
		expect(vertex.host("us")).toBe("aiplatform.us.rep.googleapis.com");
		expect(vertex.host("eu")).toBe("aiplatform.eu.rep.googleapis.com");
		expect(vertex.HOSTS).toEqual(["aiplatform.googleapis.com", "aiplatform.us.rep.googleapis.com", "aiplatform.eu.rep.googleapis.com"]);
		expect(vertex.regionOf("https://aiplatform.us.rep.googleapis.com")).toBe("us");
		expect(vertex.regionOf("https://aiplatform.eu.rep.googleapis.com/v1")).toBe("eu");
		expect(vertex.regionOf("https://aiplatform.asia.rep.googleapis.com")).toBeUndefined();
		expect(vertex.regionOf("https://us-east5-aiplatform.googleapis.com")).toBe("us-east5");
		expect(vertex.regionOf("https://aiplatform.googleapis.com/")).toBe("global");
		expect(vertex.regionOf("http://127.0.0.1:8080")).toBeUndefined();
		expect(vertex.regionOf("not a url")).toBeUndefined();
		expect(vertex.regionOf(undefined)).toBeUndefined();
	});

	it("takes the region from the setting, then the base URL, then CLOUD_ML_REGION", () => {
		const env = { CLOUD_ML_REGION: "asia-southeast1" };
		expect(vertex.regionFor({ url: "https://us-east5-aiplatform.googleapis.com", vertex: { region: "global" } }, env)).toBe("global");
		expect(vertex.regionFor({ url: "https://us-east5-aiplatform.googleapis.com" }, env)).toBe("us-east5");
		expect(vertex.regionFor({ url: "http://127.0.0.1:1", vertex: {} }, env)).toBe("asia-southeast1");
		expect(vertex.regionFor({ url: "http://127.0.0.1:1" }, {})).toBeUndefined();
		expect(vertex.regionFor({ url: "http://127.0.0.1:1" }, { CLOUD_ML_REGION: "" })).toBeUndefined();
	});

	it("reads the process environment by default", () => {
		const saved = process.env.CLOUD_ML_REGION;
		process.env.CLOUD_ML_REGION = "us-central1";
		try {
			expect(vertex.regionFor({ url: "http://127.0.0.1:1" })).toBe("us-central1");
		} finally {
			if (saved === undefined) delete process.env.CLOUD_ML_REGION;
			else process.env.CLOUD_ML_REGION = saved;
		}
	});
});

describe("locate", () => {
	it("takes the project from the setting, then ANTHROPIC_VERTEX_PROJECT_ID, GOOGLE_CLOUD_PROJECT, GCLOUD_PROJECT", () => {
		const bare = { name: "v", url: "https://us-east5-aiplatform.googleapis.com", vertex: { getToken: () => "t" } };
		expect(vertex.locate(endpoint(), { GOOGLE_CLOUD_PROJECT: "env" })).toEqual({ project: "p1", region: "us-east5" });
		const env = { ANTHROPIC_VERTEX_PROJECT_ID: "a", GOOGLE_CLOUD_PROJECT: "b", GCLOUD_PROJECT: "c" };
		expect(vertex.locate(bare, env).project).toBe("a");
		expect(vertex.locate(bare, { GOOGLE_CLOUD_PROJECT: "b", GCLOUD_PROJECT: "c" }).project).toBe("b");
		expect(vertex.locate(bare, { GCLOUD_PROJECT: "c" }).project).toBe("c");
	});

	it("reads the process environment by default", () => {
		const saved = process.env.ANTHROPIC_VERTEX_PROJECT_ID;
		process.env.ANTHROPIC_VERTEX_PROJECT_ID = "from-process";
		try {
			expect(vertex.locate({ name: "v", url: "https://us-east5-aiplatform.googleapis.com", vertex: { getToken: () => "t" } }).project).toBe(
				"from-process"
			);
		} finally {
			if (saved === undefined) delete process.env.ANTHROPIC_VERTEX_PROJECT_ID;
			else process.env.ANTHROPIC_VERTEX_PROJECT_ID = saved;
		}
	});

	it("falls back to the project of the credentials, but never reads them when a token is given directly", () => {
		const url = "https://us-east5-aiplatform.googleapis.com";
		const service = { name: "v", url, vertex: { credentials: serviceAccount("x") } };
		expect(vertex.locate(service, {}).project).toBe("sa-project");
		const user = { name: "v", url, vertex: { credentials: authorizedUser() } };
		expect(vertex.locate(user, {}).project).toBe("user-project");
		const none = { name: "v", url, vertex: { credentials: authorizedUser(undefined, { quota_project_id: undefined }) } };
		expect(() => vertex.locate(none, {})).toThrow(/no Google Cloud project/);
		const broken = { name: "v", url, vertex: { accessToken: "t", credentials: { type: "bogus" } } };
		expect(() => vertex.locate(broken, {})).toThrow(/no Google Cloud project/);
		expect(() => vertex.locate({ name: "v", url, vertex: { getToken: () => "t" } }, {})).toThrow(
			/vertex\.project, ANTHROPIC_VERTEX_PROJECT_ID or GOOGLE_CLOUD_PROJECT/
		);
	});

	it("reads the project from gcloud's application default credentials file", () => {
		const dir = fs.mkdtempSync(path.join(process.cwd(), "tmp", "vertex-"));
		try {
			fs.writeFileSync(path.join(dir, "application_default_credentials.json"), JSON.stringify(authorizedUser()));
			const found = vertex.locate({ name: "v", url: "https://us-east5-aiplatform.googleapis.com", vertex: {} }, { CLOUDSDK_CONFIG: dir });
			expect(found.project).toBe("user-project");
		} finally {
			fs.rmSync(dir, { recursive: true, force: true });
		}
	});

	it("names the missing setting for a missing project or region", () => {
		expect(() => vertex.locate({ name: "v", url: "http://127.0.0.1:1", vertex: { project: "p" } }, {})).toThrow(
			/Upstream v: no Vertex AI region; set vertex\.region or CLOUD_ML_REGION/
		);
		expect(() => vertex.locate({ name: "v", url: "http://127.0.0.1:1" }, { CLOUDSDK_CONFIG: "/nonexistent" })).toThrow(
			/no Google Cloud project/
		);
		try {
			vertex.locate({ name: "v", url: "http://127.0.0.1:1", vertex: { project: "p" } }, {});
		} catch (error) {
			expect(error).toMatchObject({ code: "INVALID_CONFIG", status: 500 });
		}
	});
});

describe("route", () => {
	it("is rawPredict, or streamRawPredict when streaming, under the project, region and model", () => {
		const base = "/v1/projects/p1/locations/us-east5/publishers/anthropic/models";
		expect(vertex.route("messages", endpoint(), "claude-sonnet-4-5@20250929")).toBe(`${base}/claude-sonnet-4-5@20250929:rawPredict`);
		expect(vertex.route("messages", endpoint(), "claude-sonnet-4-5@20250929", { stream: true })).toBe(
			`${base}/claude-sonnet-4-5@20250929:streamRawPredict`
		);
		expect(vertex.route("messages", endpoint(), undefined)).toBe(`${base}/:rawPredict`);
		expect(vertex.route("messages", endpoint(), "a/b c")).toBe(`${base}/a%2Fb%20c:rawPredict`);
		expect(vertex.route("count", endpoint(), "ignored")).toBe(`${base}/count-tokens:rawPredict`);
	});

	it("uses the region setting for the global endpoint, and the environment given", () => {
		const global = endpoint({ url: "https://aiplatform.googleapis.com", vertex: { project: "p 1" } });
		expect(vertex.route("messages", global, "m", { env: {} })).toBe(
			"/v1/projects/p%201/locations/global/publishers/anthropic/models/m:rawPredict"
		);
		const proxy = { name: "v", url: "http://127.0.0.1:1", vertex: {} };
		expect(vertex.route("count", proxy, undefined, { env: { GOOGLE_CLOUD_PROJECT: "p", CLOUD_ML_REGION: "r" } })).toBe(
			"/v1/projects/p/locations/r/publishers/anthropic/models/count-tokens:rawPredict"
		);
	});
});

describe("body", () => {
	it("adds anthropic_version first and keeps the model readable but not enumerable", () => {
		const out = vertex.body({ model: "m", max_tokens: 5, stream: true, messages: [] });
		expect(Object.keys(out)).toEqual(["anthropic_version", "max_tokens", "stream", "messages"]);
		expect(out.anthropic_version).toBe("vertex-2023-10-16");
		expect(out.model).toBe("m");
		expect(JSON.parse(JSON.stringify(out))).toEqual({ anthropic_version: "vertex-2023-10-16", max_tokens: 5, stream: true, messages: [] });
		out.model = "n";
		expect(out.model).toBe("n");
		expect(Object.keys(out)).not.toContain("model");
	});

	it("keeps an anthropic_version the request already has", () => {
		expect(vertex.body({ model: "m", anthropic_version: "vertex-2024-01-01" }).anthropic_version).toBe("vertex-2024-01-01");
	});
});
