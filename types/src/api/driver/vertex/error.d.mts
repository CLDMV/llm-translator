/**
 * Normalize Google's error envelope (`{ error: { code, message, status } }`, sometimes inside a one-element array) and Claude's own
 * (`{ type: "error", error: { type, message } }`, which Vertex AI passes through) to the nested shape. Google's `status` (`NOT_FOUND`) becomes the code.
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
