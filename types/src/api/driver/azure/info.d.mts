/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/api/driver/azure/info.mjs
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
 * @fileoverview Azure OpenAI driver: static facts about the hosted Azure OpenAI API.
 * @module @cldmv/llm-translator/driver/azure
 */
/**
 * Describe the Azure OpenAI driver. The key goes in the `api-key` header. The real paths come from the `path` leaf, because they depend on the
 * upstream's `apiVersion` and `deployment`; `paths` holds the v1 API paths for a base URL without `/openai`.
 * @returns {{name: string, protocol: string, order: number, auth: string, strict: boolean, paths: Record<string,string>}} Driver facts.
 */
export function info(): {
    name: string;
    protocol: string;
    order: number;
    auth: string;
    strict: boolean;
    paths: Record<string, string>;
};
