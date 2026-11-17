/**
 * @fileoverview Detection binds an upstream whose host a driver names before any driver sends a probe.
 * @module @cldmv/llm-translator/test/driver/host-first
 */
import { afterEach, describe, expect, it } from "vitest";
import { closeAll, fakeTransport, make } from "../helpers/translator.mjs";

afterEach(closeAll);

const vllmAnswers = (url) => {
	if (url.endsWith("/version")) return { body: { version: "0.22.0" } };
	if (url.endsWith("/v1/models")) return { body: { data: [{ id: "m", object: "model", owned_by: "vllm", max_model_len: 4096 }] } };
	return { status: 404 };
};

describe("host-matched upstreams bind with no request", () => {
	it.each([
		["https://api.groq.com", "groq"],
		["https://api.openai.com", "openai"],
		["https://api.deepseek.com", "deepseek"],
		["https://api.mistral.ai", "mistral"],
		["https://openrouter.ai", "openrouter"],
		["https://api.x.ai", "xai"],
		["https://api.anthropic.com", "anthropic"],
		["https://my-resource.openai.azure.com", "azure"]
	])("%s binds %s without touching the network", async (url, driver) => {
		// A server that would be taken for vLLM if anyone asked it.
		const transport = fakeTransport((requested) => vllmAnswers(requested));
		const api = await make({ upstreams: [url], transport });
		expect(api.status().upstreams[0].driver).toBe(driver);
		expect(transport.calls).toEqual([]);
	});

	it("binds every host-matched upstream of a mixed pool without a request, and probes the rest", async () => {
		const transport = fakeTransport((requested) => vllmAnswers(requested));
		const api = await make({
			upstreams: [
				{ url: "https://api.groq.com", name: "hosted" },
				{ url: "http://local.test", name: "local" }
			],
			transport
		});
		const byName = Object.fromEntries(api.status().upstreams.map((entry) => [entry.name, entry.driver]));
		expect(byName).toEqual({ hosted: "groq", local: "vllm" });
		expect(transport.calls.length).toBeGreaterThan(0);
		expect(transport.calls.every((call) => call.url.startsWith("http://local.test"))).toBe(true);
	});

	it("still probes a host no driver names, in driver order", async () => {
		const transport = fakeTransport((requested) => vllmAnswers(requested));
		const api = await make({ upstreams: ["http://unlisted.test"], transport });
		expect(api.status().upstreams[0].driver).toBe("vllm");
		expect(transport.calls.map((call) => call.url)).toEqual(
			expect.arrayContaining(["http://unlisted.test/version", "http://unlisted.test/v1/models"])
		);
	});

	it("does not take a URL that does not parse for a host match", async () => {
		const transport = fakeTransport(() => ({ status: 500 }));
		const api = await make({ upstreams: ["not a url"], transport });
		expect(api.status().upstreams[0].driver).toBe("compatible");
	});

	it("falls back to probing when the driver that names the host declines it", async () => {
		const transport = fakeTransport((requested) => vllmAnswers(requested));
		const api = await make({ upstreams: ["http://decline.test"], transport, detect: false });
		await api.slothlet.api.add(["driver", "declines"], new URL("../fixtures/driver/declines", import.meta.url).pathname);
		const status = await api.detect();
		expect(status.upstreams[0].driver).toBe("vllm");
		expect(transport.calls.length).toBeGreaterThan(0);
	});

	it("matches a hosted API whose vLLM-like answer would have won on order", async () => {
		const transport = fakeTransport((requested) => vllmAnswers(requested));
		const api = await make({ upstreams: ["https://api.openai.com/v1"], transport });
		expect(api.driver.vllm.info().order).toBeLessThan(api.driver.openai.info().order);
		expect(api.status().upstreams[0].driver).toBe("openai");
		expect(transport.calls).toEqual([]);
	});
});
