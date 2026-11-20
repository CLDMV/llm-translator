/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/api/driver/bedrock/detect.mjs
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
 * @fileoverview Amazon Bedrock driver: matches the Bedrock runtime host names (there is no probe request).
 * @module @cldmv/llm-translator/driver/bedrock
 */
import { regionOfHost } from "../../../lib/bedrock.mjs";

/**
 * Match by host name, no network access: `bedrock-runtime.<region>.amazonaws.com`, its FIPS and VPC endpoint forms, and the China partition.
 * @param {any} context - `{ endpoint }`.
 * @returns {{host: string, region: string} | null} Facts, or null when the host is not a Bedrock runtime host.
 */
export function detect({ endpoint }) {
	const host = URL.canParse(endpoint.url) ? new URL(endpoint.url).hostname : "";
	const region = regionOfHost(host);
	return region === null ? null : { host, region };
}
