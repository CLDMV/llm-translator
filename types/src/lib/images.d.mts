/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/lib/images.mjs
 *	@Date: 2026-10-26T09:00:00-07:00 (1793030400)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-10-26T09:00:00-07:00 (1793030400)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */
/**
 * @fileoverview Image handling for upstreams that turn out to be text-only: recognising the refusal, finding images in a
 * Chat Completions body and replacing them with a note.
 * @module @cldmv/llm-translator/lib/images
 */
/** Text that replaces an image when the model does not accept images. */
export declare const NOTE = "[An image was omitted because this model does not accept images.]";
/**
 * Does an upstream error message say the model does not accept images?
 * @param {string} message - Upstream error message.
 * @returns {boolean} True for a known "no image input" wording.
 */
export declare function refused(message: string): boolean;
/**
 * Does a Chat Completions body carry image parts?
 * @param {any} body - Upstream request body.
 * @returns {boolean} True when any message content has an `image_url` part.
 */
export declare function carries(body: any): boolean;
/**
 * Copy a Chat Completions body with every image part replaced by a short text note.
 * @param {any} body - Upstream request body.
 * @returns {any} New body; messages without images are shared with the input.
 */
export declare function strip(body: any): any;
