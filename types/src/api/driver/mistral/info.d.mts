/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/api/src/api/driver/mistral/info.mjs
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
 * @fileoverview Mistral driver: static facts about the hosted Mistral API.
 * @module @cldmv/llm-translator/driver/mistral
 */
/**
 * Describe the Mistral driver. Mistral accepts only 9-character alphanumeric tool-call ids, so the translator rewrites the client's ids.
 * @returns {{name: string, protocol: string, order: number, auth: string, strict: boolean, toolCallIds: {alphabet: string, min: number, max: number}, paths: Record<string,string>}} Driver facts.
 */
export function info(): {
    name: string;
    protocol: string;
    order: number;
    auth: string;
    strict: boolean;
    toolCallIds: {
        alphabet: string;
        min: number;
        max: number;
    };
    paths: Record<string, string>;
};
