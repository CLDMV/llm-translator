/**
 * How many branches a request needs: `n` when the OpenAI-front body asks for more than one choice and the router would send it to an
 * Anthropic-protocol upstream, else 0 (the request goes the normal way: an OpenAI-protocol upstream handles `n` itself, and a value
 * that is not an integer above 1 is left to the converter's own validation). The decision is made on the endpoint the router picks
 * first; each branch is then routed and failed over like any request.
 * @param {any} c - Captured translator parts (`capture`).
 * @param {any} body - Client request body.
 * @returns {number} Branch count, or 0 for no fan-out.
 * @throws {TranslatorError} `invalid_request` when `n` is above {@link MAX}.
 */
export function wants(c: any, body: any): number;
/**
 * Add two usage objects field by field (numbers add, nested objects such as `prompt_tokens_details` recurse, a field only one side has is kept).
 * @param {any} left - Usage object.
 * @param {any} right - Usage object.
 * @returns {any} The sum.
 */
export function add(left: any, right: any): any;
/**
 * Combine the replies of the branches of a non-streaming request: the first branch's reply with every branch's choice, numbered by
 * branch, and the usage summed.
 * @param {any[]} bodies - Chat completion bodies, one per branch, in order.
 * @returns {any} The combined body.
 */
export function join(bodies: any[]): any;
/**
 * Merge the streams of the branches into one: chunks go out as they arrive from any branch, each re-indexed to its branch and carrying
 * the first chunk's id; the branches' own `[DONE]` sentinels and usage chunks are held back, and the stream ends with one usage chunk
 * holding the sum (when the branches sent one) and a single `[DONE]`. A branch that sends an error chunk or throws ends the merged
 * stream the way the stream converter ends a failed one: the error chunk, then `[DONE]`; the other branches are cancelled. Closing
 * the merged stream early cancels every branch.
 * @param {AsyncIterable<{event?: string, data: any}>[]} streams - Branch streams, in choice order.
 * @param {() => void} abort - Aborts the branches' requests.
 * @param {(index: number) => void} trip - Called with the index of the branch whose failure ended the stream.
 * @returns {AsyncIterableIterator<{event?: string, data: any}>} Merged stream, closable with `return()`.
 */
export function weave(streams: AsyncIterable<{
    event?: string;
    data: any;
}>[], abort: () => void, trip: (index: number) => void): AsyncIterableIterator<{
    event?: string;
    data: any;
}>;
/**
 * Answer a request with `count` parallel single-choice requests. Each branch is a full `send` of the body with `n: 1` (so it is routed,
 * failed over, captured and metered like any request, and its own `onUsage` feeds the combined report). The first branch to fail
 * (an error reply, or a thrown error such as an abort) ends the request: the others are aborted, the failure is the reply (or is
 * rethrown), and the streams of branches that had already started are closed so their usage settles. The caller's signal cancels every
 * branch. A branch that fails after the stream has started is handled by {@link weave}.
 * @param {object} spec - `{ body, count, options, send, warn }`.
 * @param {any} spec.body - Client request body (`n` above 1).
 * @param {number} spec.count - Number of branches.
 * @param {any} spec.options - The `send` options of the request.
 * @param {(body: any, options: any) => Promise<any>} spec.send - The single-request send.
 * @param {(message: string, details: {kind: "threw" | "rejected"}) => void} spec.warn - Receives a message when `onUsage` throws or rejects.
 * @returns {Promise<any>} The reply, with a non-enumerable `usage` promise of the combined report.
 */
export function run({ body, count, options, send, warn }: {
    body: any;
    count: number;
    options: any;
    send: (body: any, options: any) => Promise<any>;
    warn: (message: string, details: {
        kind: "threw" | "rejected";
    }) => void;
}): Promise<any>;
/** The largest `n` that is fanned out (OpenAI's own limit for the parameter). */
export const MAX: 128;
