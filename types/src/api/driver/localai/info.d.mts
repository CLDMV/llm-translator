/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/api/driver/localai/info.mjs
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
 * @fileoverview LocalAI driver: static facts about the LocalAI server.
 * @module @cldmv/llm-translator/driver/localai
 */
/**
 * Describe the LocalAI driver. It is found through `GET /version` (`{ version: "v3.1.0 (<commit>)" }`) or LocalAI's discovery document at
 * `GET /.well-known/localai.json`. The extra fields are the ones LocalAI's request schema accepts beyond the OpenAI set.
 * @returns {{name: string, protocol: string, order: number, auth: string, strict: boolean, probes: string[], fields: string[], paths: Record<string,string>}} Driver facts.
 */
export function info(): {
    name: string;
    protocol: string;
    order: number;
    auth: string;
    strict: boolean;
    probes: string[];
    fields: string[];
    paths: Record<string, string>;
};
