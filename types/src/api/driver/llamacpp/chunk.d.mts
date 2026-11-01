/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/api/driver/llamacpp/chunk.mjs
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
 * Give a streamed tool call that starts without an id one. The id is made when the call's name first arrives (the first fragment of the call);
 * later fragments of the same call carry no id, as in OpenAI streams. Ids made so far are kept in `ctx.state.toolIds` (index to id).
 * @param {any} chunk - Parsed `chat.completion.chunk`.
 * @param {any} [ctx] - `{ state }`.
 * @returns {any} Normalized chunk.
 */
export declare function chunk(chunk: any, ctx?: any): any;
