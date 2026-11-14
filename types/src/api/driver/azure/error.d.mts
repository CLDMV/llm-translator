/**
 * Normalize to the nested OpenAI shape. A prompt refused by Azure's content filter (HTTP 400, `error.code: "content_filter"`) keeps its code and
 * `param`, and its message names the categories that were filtered when `innererror.content_filter_result` says so.
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
