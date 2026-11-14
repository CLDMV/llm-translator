/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/api/driver/azure/detect.mjs
 *	@Date: 2026-11-13T09:00:00-08:00 (1794589200)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-11-13T09:00:00-08:00 (1794589200)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

/**
 * @fileoverview Azure OpenAI driver: matches the Azure OpenAI, Azure AI Services and Foundry host names.
 * @module @cldmv/llm-translator/driver/azure
 */

/** Host name suffixes of Azure OpenAI resources: classic OpenAI resources, multi-service AI Services resources and Foundry resources. */
const SUFFIXES = [".openai.azure.com", ".cognitiveservices.azure.com", ".services.ai.azure.com"];

/**
 * Match by host name, no network access.
 * @param {any} context - `{ endpoint }`.
 * @returns {{host: string} | null} Facts, or null when the host is not an Azure OpenAI resource.
 */
export function detect({ endpoint }) {
	const host = URL.canParse(endpoint.url) ? new URL(endpoint.url).hostname : "";
	return SUFFIXES.some((suffix) => host.endsWith(suffix)) ? { host } : null;
}
