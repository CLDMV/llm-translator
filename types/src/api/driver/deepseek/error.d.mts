/**
 * Normalize to the nested OpenAI shape and explain DeepSeek's `reasoning_content` refusal.
 * @param {number} status - HTTP status.
 * @param {*} body - Parsed upstream error body.
 * @returns {{error: {message: string, type: string | undefined, param: *, code: *}}} Nested error body.
 */
export function error(status: number, body: any): {
    error: {
        message: string;
        type: string | undefined;
        param: any;
        code: any;
    };
};
