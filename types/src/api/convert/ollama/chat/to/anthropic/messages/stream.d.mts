/**
 * Convert an Ollama stream (one JSON object per line, possibly split anywhere across chunks) to Anthropic events. The lines become Chat
 * Completions chunks (one id for the reply, tool calls whole with generated ids, the final line as the finish and usage chunks) and the Chat
 * Completions conversion writes the events. A line that is not JSON, an `{ error }` line and a stream that ends before its final line each
 * end the stream with an `error` event.
 * @param {ReadableStream|AsyncIterable<unknown>|Iterable<unknown>|string|Uint8Array} source - Ollama NDJSON bytes or text.
 * @param {any} [state] - State from the request converter.
 * @param {Partial<import("../../../../../../../lib/settings.mjs").Settings>} [settings] - Translator settings.
 * @returns {AsyncGenerator<{ event: string, data: any }, void, undefined>} Anthropic events.
 */
export function stream(source: ReadableStream | AsyncIterable<unknown> | Iterable<unknown> | string | Uint8Array, state?: any, settings?: Partial<import("../../../../../../../lib/settings.mjs").Settings>): AsyncGenerator<{
    event: string;
    data: any;
}, void, undefined>;
