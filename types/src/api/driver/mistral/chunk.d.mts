/**
 * Flatten typed content chunks in a streamed delta. While a reasoning model thinks, `delta.content` is a list holding a `thinking` chunk; the
 * switch to the answer is a list with the closing `thinking` chunk and the first `text` chunk; the answer then streams as a plain string.
 * The thinking goes to `reasoning_content` and the text to `content`.
 * @param {any} chunk - Parsed `chat.completion.chunk`.
 * @returns {any} Normalized chunk.
 */
export function chunk(chunk: any): any;
