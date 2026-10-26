/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/lib/passthrough.mjs
 *	@Date: 2026-10-25T12:49:46-07:00 (1792957786)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-10-25T12:59:02-07:00 (1792958342)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */
/**
 * Keep only known Chat Completions and documented vLLM extension fields, so an untrusted client cannot inject server-side
 * controls such as `kv_transfer_params`, `vllm_xargs`, `chat_template`, `cache_salt` or `priority`. `stream_options` is
 * reduced to the usage flags.
 * @param {any} body - Client request body.
 * @returns {any} Filtered copy.
 */
export declare function filterChatBody(body: any): any;
