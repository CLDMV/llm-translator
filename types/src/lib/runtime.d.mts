/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/lib/runtime.mjs
 *	@Date: 2026-10-25T12:30:20-07:00 (1792956620)
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
 * Per-instance context (`config`, `state`); valid only synchronously inside a leaf call.
 * @type {any}
 */
export declare const context: any;
/**
 * Proxy over the whole api (`self.convert.…`, `self.driver.…`); valid only synchronously inside a leaf call.
 * @type {any}
 */
export declare const self: any;
