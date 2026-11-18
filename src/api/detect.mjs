/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/api/detect.mjs
 *	@Date: 2026-10-25T12:29:36-07:00 (1792956576)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-10-25T12:58:59-07:00 (1792958339)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

/**
 * @fileoverview Root api: probe the upstreams and bind each to a driver.
 * @module @cldmv/llm-translator/detect
 */
import { context, self } from "../lib/runtime.mjs";
import { capture } from "../lib/capture.mjs";
import { TranslatorError } from "../lib/errors.mjs";
import { warn } from "../lib/warn.mjs";
import { emit } from "../lib/events.mjs";
import * as http from "../lib/http.mjs";
import { validToolIdPolicy } from "../lib/ids.mjs";
import { PROTOCOL as RESPONSES } from "../lib/responses-upstream.mjs";

/**
 * Bind every endpoint to a driver. `backend: "auto"` endpoints are probed (drivers tried in `info().order` after any driver whose `info().hosts` names the endpoint host, the generic
 * driver matches last); endpoints with an explicit `backend` skip detection. Call it again to re-probe.
 * @param {any} [options] - `{ network, signal }`. `network: false` skips all probing (auto endpoints fall back to the generic driver).
 * @returns {Promise<any>} The `status()` result.
 */
export async function detect(options = {}) {
	const c = capture(self, context);
	const { status } = self;
	const network = options.network !== false;
	for (const driver of c.drivers) {
		const fields = driver.info.fields;
		if (fields !== undefined && !(Array.isArray(fields) && fields.every((field) => typeof field === "string"))) {
			throw new TranslatorError(`Driver ${driver.name}: info().fields must be an array of field names`, {
				code: "invalid_driver",
				status: 500
			});
		}
	}
	for (const driver of c.drivers) {
		const ids = driver.info.toolCallIds;
		if (ids !== undefined && !validToolIdPolicy(ids)) {
			throw new TranslatorError(
				`Driver ${driver.name}: info().toolCallIds must be { alphabet, min?, max? } with a character-class alphabet and positive integer bounds`,
				{ code: "invalid_driver", status: 500 }
			);
		}
	}
	const probe = { transport: c.state.transport, signal: options.signal, timeout: c.config.detectTimeout };
	await Promise.all(c.state.endpoints.map((endpoint) => bind(c, endpoint, network, probe)));
	return status();
}

/**
 * Detect and bind one endpoint.
 * @param {any} c - Captured translator parts.
 * @param {any} endpoint - Runtime endpoint (mutated).
 * @param {boolean} network - Whether probing is allowed.
 * @param {any} probe - `{ transport, signal, timeout }`.
 * @returns {Promise<void>} Resolves when the endpoint is bound.
 */
async function bind(c, endpoint, network, probe) {
	let driver;
	let facts = null;
	if (endpoint.backend !== "auto") {
		driver = c.drivers.find((entry) => entry.name === endpoint.backend);
		if (!driver) {
			throw new TranslatorError(`Unknown backend "${endpoint.backend}" for upstream ${endpoint.name}`, {
				code: "unknown_backend",
				status: 500
			});
		}
		facts = { version: endpoint.version };
	} else if (network) {
		// Paths are fetched once per endpoint and shared between drivers (see `http.probe`). Host-name drivers need no network. At the
		// first driver that probes, the paths every remaining driver declares in `info().probes` are requested together, so detection
		// costs the slowest probe, not their sum, and a server that matches an earlier driver is never asked for them.
		// A driver that lists `hosts` and matches this endpoint's host is answered without a request, so it does not start the batch.
		const host = URL.canParse(endpoint.url) ? new URL(endpoint.url).hostname : "";
		const context = { endpoint, ...probe, probes: new Map() };
		// A driver that declares the endpoint's host (`info().hosts`, `info().hostSuffixes`) is tried before any driver that probes, so a
		// hosted upstream such as api.groq.com or api.openai.com is bound without a single request, whatever the driver order says.
		const named = c.drivers.filter((candidate) => matchesHost(candidate.info, host));
		for (const candidate of named) {
			facts = await detectWith(candidate, context);
			if (facts) {
				driver = candidate;
				break;
			}
		}
		let fetched = false;
		for (const [index, candidate] of driver ? [] : c.drivers.entries()) {
			if (!fetched && candidate.info.probes?.length > 0 && !candidate.info.hosts?.includes(host)) {
				fetched = true;
				for (const later of c.drivers.slice(index)) for (const path of later.info.probes ?? []) http.probe(context, path, later.info);
			}
			facts = await detectWith(candidate, context);
			if (facts) {
				driver = candidate;
				break;
			}
		}
	}
	if (!driver) {
		driver = c.drivers.find((entry) => entry.name === "compatible");
		facts = { reachable: null, models: [] };
	}
	// A fresh detection forgets that the upstream once answered 404 to vLLM's native `/v1/messages`...
	c.state.noMessages.delete(endpoint.name);
	// ...and the readiness it was probed with.
	Object.assign(endpoint.health, { ready: null, readyReason: null, checkedAt: null, unsupported: false });
	endpoint.driver = driver.name;
	endpoint.protocol = driver.info.protocol;
	if (endpoint.api === "responses" && !driver.info.responses && driver.info.protocol !== RESPONSES) {
		const named = c.drivers.filter((entry) => entry.info.responses).map((entry) => entry.name);
		throw new TranslatorError(
			`Upstream ${endpoint.name}: api "responses" needs a driver for a server that has the Responses API (${named.join(", ")}), but the upstream is bound to ${driver.name}; set backend to one of them`,
			{ code: "unsupported_api", status: 500 }
		);
	}
	// A driver that declares `info().responses: "prefer"` is a server whose Chat Completions API lacks something the Responses API has, so
	// `api: "auto"` picks the Responses API for it; no bundled driver prefers it, and the default `api: "openai"` never does.
	if (endpoint.api === "responses" || (endpoint.api === "auto" && driver.info.responses === "prefer")) endpoint.protocol = RESPONSES;
	if (endpoint.api === "native") {
		// The server's own chat API instead of its OpenAI-compatible one, for a driver that declares it in `info().native`.
		if (!driver.info.native) {
			const named = c.drivers.filter((entry) => entry.info.native).map((entry) => entry.name);
			throw new TranslatorError(
				`Upstream ${endpoint.name}: api "native" needs a driver with a native API (${named.join(", ")}), but the upstream is bound to ${driver.name}; set backend to one of them`,
				{ code: "unsupported_api", status: 500 }
			);
		}
		endpoint.protocol = driver.info.native.protocol;
	}
	endpoint.facts = facts;
	endpoint.driverSettings = (await driver.settings?.(facts)) ?? {};
	// Reasoning models need their encrypted reasoning items back between turns on a stateless Responses call.
	if (endpoint.protocol === RESPONSES) endpoint.driverSettings = { reasoningRoundTrip: true, ...endpoint.driverSettings };
	endpoint.probed = {};
	if (network && endpoint.backend === "auto" && driver.probe) {
		// Only probe what the configuration leaves open: explicit settings always win.
		const given = (key) => endpoint.settings[key] !== undefined || c.config.settings[key] !== undefined;
		const want = { inlineSystem: c.settings(endpoint).inlineSystem === "auto", images: !given("images") };
		if (want.inlineSystem || want.images) endpoint.probed = await driver.probe({ endpoint, facts, want, ...probe });
	}
	if (facts.reachable === false) {
		warn(
			c.config,
			c.state,
			`Upstream ${endpoint.name} (${endpoint.url}) did not answer detection; using the generic OpenAI-compatible driver`,
			{ type: "detect", kind: "unreachable", endpoint: endpoint.name, url: endpoint.url, driver: driver.name }
		);
	} else {
		emit(
			{ config: c.config, state: c.state },
			{
				type: "detect",
				kind: "driver",
				level: "info",
				message: `Upstream ${endpoint.name} (${endpoint.url}): driver ${driver.name}`,
				endpoint: endpoint.name,
				url: endpoint.url,
				driver: driver.name
			}
		);
	}
}

/**
 * Whether a driver's `info()` declares a host name: an exact one in `hosts`, or a suffix in `hostSuffixes`.
 * @param {any} info - Driver facts.
 * @param {string} host - The endpoint's host name (empty when the URL does not parse).
 * @returns {boolean} True when the driver names the host.
 */
function matchesHost(info, host) {
	return host !== "" && (info.hosts?.includes(host) === true || info.hostSuffixes?.some((suffix) => host.endsWith(suffix)) === true);
}

/**
 * Run one driver's detection; an error counts as "no match".
 * @param {any} driver - Driver record.
 * @param {any} context - Detection context.
 * @returns {Promise<any | null>} Facts or null.
 */
async function detectWith(driver, context) {
	try {
		return (await driver.detect?.(context)) ?? null;
	} catch {
		return null;
	}
}
