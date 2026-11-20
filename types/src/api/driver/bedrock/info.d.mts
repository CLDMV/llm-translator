/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/api/driver/bedrock/info.mjs
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
 * @fileoverview Amazon Bedrock driver: static facts about the Bedrock runtime.
 * @module @cldmv/llm-translator/driver/bedrock
 */
/**
 * Describe the Bedrock driver. Claude models go through InvokeModel with an Anthropic Messages body (`anthropic.messages`); every other model
 * goes through Converse (`bedrock.converse`). Under `api: "auto"` the model id chooses (see `lib/capture`). Replies stream as
 * `application/vnd.amazon.eventstream` frames (`frames`). The real paths come from the `path` leaf, because they carry the model id, and the
 * `sign` leaf authenticates every call (a Bedrock API key as a bearer token, or SigV4).
 * @returns {{name: string, protocol: string, protocols: string[], order: number, auth: string, strict: boolean, frames: string, hostSuffixes: string[], paths: Record<string,string>}} Driver facts.
 */
export function info(): {
    name: string;
    protocol: string;
    protocols: string[];
    order: number;
    auth: string;
    strict: boolean;
    frames: string;
    hostSuffixes: string[];
    paths: Record<string, string>;
};
