/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/api/driver/llamacpp/flush.mjs
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
 * @fileoverview llama.cpp driver: end-of-stream flush for the chunk normalizer.
 * @module @cldmv/llm-translator/driver/llamacpp
 */
/**
 * Release the content the chunk normalizer was still holding when the stream ended. While it waits to see whether the content opens with
 * `<think>` it holds a partial prefix (`<`, `<thi`) or whitespace; if the stream ends there, that text is the answer and goes out as one
 * more content chunk. Text held inside a repeated think block (`deepseek-legacy`) is the duplicate and is not released.
 * @param {any} ctx - `{ state }`.
 * @returns {any[]} Chunks to emit (empty when nothing is held).
 */
export declare function flush(ctx: any): any[];
