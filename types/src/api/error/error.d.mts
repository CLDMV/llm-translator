/**
 * Convert an upstream error reply into `{ status, headers, body }` in the client protocol. Context-window overflows
 * become Anthropic's "prompt is too long: N tokens > MAX maximum" (which triggers Claude Code's compaction); status codes
 * map 1:1; `retry-after` is kept. A 400 that says the server has no tool parser (vLLM without `--enable-auto-tool-choice` and `--tool-call-parser`) gets a hint naming the missing flags.
 * @param {number} status - Upstream HTTP status.
 * @param {*} upstreamBody - Parsed upstream error body (object or text).
 * @param {Record<string,string>} [headers] - Lowercase upstream response headers.
 * @param {any} [state] - The `state` returned by `request` (selects the driver normalizer and native handling).
 * @returns {Promise<{status: number, headers: Record<string,string>, body: any}>} Client-shaped error reply.
 */
export default function error(status: number, upstreamBody: any, headers?: Record<string, string>, state?: any): Promise<{
    status: number;
    headers: Record<string, string>;
    body: any;
}>;
