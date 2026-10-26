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

/**
 * Bind every endpoint to a driver. `backend: "auto"` endpoints are probed (drivers tried in `info().order`, the generic
 * driver matches last); endpoints with an explicit `backend` skip detection. Call it again to re-probe.
 * @param {any} [options] - `{ network, signal }`. `network: false` skips all probing (auto endpoints fall back to the generic driver).
 * @returns {Promise<any>} The `status()` result.
 */
export async function detect(options = {}) {
	const c = capture(self, context);
	const { status } = self;
	const network = options.network !== false;
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
		for (const candidate of c.drivers) {
			facts = await detectWith(candidate, { endpoint, ...probe });
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
	endpoint.driver = driver.name;
	endpoint.protocol = driver.info.protocol;
	endpoint.facts = facts;
	endpoint.driverSettings = (await driver.settings?.(facts)) ?? {};
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
			`Upstream ${endpoint.name} (${endpoint.url}) did not answer detection; using the generic OpenAI-compatible driver`
		);
	}
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
