/**
 * The same conversion, or, for an upstream that was sent hosted tools as they were (`hostedTools: "native"`), the upstream's own events: its chunks
 * carry them as `llmt_event` and they are passed on unchanged, with nothing synthesized around them.
 * @param {ReadableStream|AsyncIterable<unknown>|Iterable<unknown>|string|Uint8Array} source - Chat Completions stream.
 * @param {any} state - State from the request converter (`model`, `echo`).
 * @param {Partial<import("../../../../../../../lib/settings.mjs").Settings>} [settings] - Translator settings.
 * @returns {AsyncGenerator<{ event: string, data: any }, void, undefined>} Responses events.
 */
export function stream(source: ReadableStream | AsyncIterable<unknown> | Iterable<unknown> | string | Uint8Array, state: any, settings?: Partial<import("../../../../../../../lib/settings.mjs").Settings>): AsyncGenerator<{
    event: string;
    data: any;
}, void, undefined>;
