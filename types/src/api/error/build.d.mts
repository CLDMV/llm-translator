/**
 * Build `{ status, headers, body }` in the client protocol.
 * @param {number} status - HTTP status.
 * @param {string} message - Error message.
 * @param {any} [options] - `{ type, code, param, front }` overrides; `type` is an Anthropic error type (mapped for the OpenAI front) and `front` defaults to the configured front.
 * @returns {{status: number, headers: Record<string,string>, body: any}} Client-shaped error reply.
 */
export function build(status: number, message: string, options?: any): {
    status: number;
    headers: Record<string, string>;
    body: any;
};
