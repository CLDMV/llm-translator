/**
 * Anthropic error type for an HTTP status.
 * @param {number} status - HTTP status.
 * @returns {string} Anthropic `error.type`.
 */
export function anthropicType(status: number): string;
/**
 * OpenAI error type for an HTTP status.
 * @param {number} status - HTTP status.
 * @returns {string} OpenAI `error.type`.
 */
export function openaiType(status: number): string;
/**
 * Pull `{ message, type, code, param }` out of any known upstream error body shape: nested OpenAI/vLLM
 * (`{error:{message,type,param,code}}`), flat old vLLM (`{message,type,param,code}`), Anthropic
 * (`{type:"error",error:{type,message}}`), `{error:"text"}`, a bare string, or nothing.
 * @param {*} body - Parsed upstream body.
 * @param {number} status - HTTP status, used for the fallback message.
 * @returns {{message: string, type?: string, code?: *, param?: *}} Normalized error.
 */
export function parse(body: any, status: number): {
    message: string;
    type?: string;
    code?: any;
    param?: any;
};
/**
 * Render an error body in the client protocol.
 * @param {"anthropic" | "openai"} front - Client protocol.
 * @param {number} status - HTTP status.
 * @param {{message: string, type?: string, code?: *, param?: *}} info - Normalized error.
 * @param {any} [options] - `{ native: boolean }`: keep the upstream `type` when it is already valid for this protocol.
 * @returns {{status: number, body: any}} Status and body in the client shape.
 */
export function render(front: "anthropic" | "openai", status: number, info: {
    message: string;
    type?: string;
    code?: any;
    param?: any;
}, options?: any): {
    status: number;
    body: any;
};
