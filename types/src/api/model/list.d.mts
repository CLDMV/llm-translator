/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/api/model/list.mjs
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
 * List the models the upstreams serve (live when the driver can, else detection/config data), plus the configured aliases,
 * in the client protocol's list shape (Anthropic `{data:[{type:"model",...}]}` or OpenAI `{object:"list",data:[...]}`).
 * @param {any} [options] - `{ signal, front }`.
 * @returns {Promise<any>} Model list.
 */
export declare function list(options?: any): Promise<any>;
