/**
 * Whether a Chat body asks for automatic compaction.
 * @param {any} c - Captured translator parts.
 * @param {any} body - Chat body of a Responses request.
 * @param {any} options - The `send` options.
 * @returns {boolean} True when the request converter left a threshold on it.
 * @throws {TranslatorError} `unsupported_field` for a request that also sends hosted tools natively (`hostedTools: "native"`): the upstream's own events cannot carry the compaction item.
 */
export function wants(c: any, body: any, options: any): boolean;
/**
 * Answer a request that asked for automatic compaction. See the module comment.
 * @param {object} spec - `{ body, options, send, warn, count, fail }`.
 * @param {any} spec.body - Chat body with `llmt_compact`.
 * @param {any} spec.options - The `send` options of the request.
 * @param {(body: any, options: any) => Promise<any>} spec.send - The single-request send.
 * @param {(message: string, details: {kind: "threw" | "rejected"}) => void} spec.warn - Receives a message when `onUsage` throws or rejects.
 * @param {(body: any) => Promise<{input_tokens: number}>} spec.count - Counts the prompt tokens of a Chat body.
 * @param {(status: number, message: string, details: any) => any} spec.fail - Builds an error reply.
 * @returns {Promise<any>} The reply, with a non-enumerable `usage` promise of the combined report.
 */
export function run({ body, options, send: direct, warn, count, fail }: {
    body: any;
    options: any;
    send: (body: any, options: any) => Promise<any>;
    warn: (message: string, details: {
        kind: "threw" | "rejected";
    }) => void;
    count: (body: any) => Promise<{
        input_tokens: number;
    }>;
    fail: (status: number, message: string, details: any) => any;
}): Promise<any>;
