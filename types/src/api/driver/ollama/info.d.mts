/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/api/driver/ollama/info.mjs
 *	@Date: 2026-10-31T14:00:00-07:00 (1793480400)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-10-31T14:00:00-07:00 (1793480400)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */
/**
 * @fileoverview Ollama driver: static facts about Ollama's OpenAI-compatible `/v1` endpoint.
 * @module @cldmv/llm-translator/driver/ollama
 */
/**
 * Describe the Ollama driver.
 * @returns {{name: string, protocol: string, order: number, auth: string, probes: string[], paths: Record<string,string>}} Driver facts.
 */
export function info(): {
    name: string;
    protocol: string;
    order: number;
    auth: string;
    probes: string[];
    paths: Record<string, string>;
};
