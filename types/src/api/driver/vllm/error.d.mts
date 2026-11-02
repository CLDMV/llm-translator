/**
 * Normalize old flat (`{message,type,code}`) and nested vLLM error bodies to the nested OpenAI shape.
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
