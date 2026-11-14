/**
 * The error a reply that answered HTTP 200 carries: `choices[i].error` on every choice (the provider failed while generating; the choice's
 * `finish_reason` is `"error"` and any partial text is not used), or a top-level `error` with no choices.
 * @param {any} body - Parsed reply body.
 * @returns {{code: any, message: string, metadata?: any} | null} The error object, or null when the reply has none to report.
 */
export function found(body: any): {
    code: any;
    message: string;
    metadata?: any;
} | null;
/**
 * The `TranslatorError` for an OpenRouter error object. Its numeric `code` is the HTTP status when it is a client or server error, else 502; the
 * `code` of the error is `metadata.error_type` when OpenRouter gives one, else `upstream_error`.
 * @param {{code?: any, message: string, metadata?: any}} error - Error object.
 * @returns {TranslatorError} Error to throw.
 */
export function failure(error: {
    code?: any;
    message: string;
    metadata?: any;
}): TranslatorError;
import { TranslatorError } from "./errors.mjs";
