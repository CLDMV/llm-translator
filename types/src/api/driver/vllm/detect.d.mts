/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/api/driver/vllm/detect.mjs
 *	@Date: 2026-10-25T12:29:36-07:00 (1792956576)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-10-25T12:59:00-07:00 (1792958340)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */
/**
 * Probe an endpoint for vLLM.
 * @param {any} context - `{ endpoint, transport, signal, timeout }`.
 * @returns {Promise<any | null>} Facts `{ version, models, maxModelLen }`, or null when the endpoint is not vLLM.
 */
export declare function detect({ endpoint, transport, signal, timeout }: any): Promise<any | null>;
