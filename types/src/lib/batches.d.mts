/**
 * Whether a value is a plain object (not null, not an array).
 * @param {any} value - Value.
 * @returns {boolean} True for an object.
 */
export function isObject(value: any): boolean;
/**
 * A client error.
 * @param {number} status - HTTP status.
 * @param {string} message - Message.
 * @param {string} code - Error code.
 * @param {string} [param] - Offending parameter.
 * @returns {TranslatorError} Error.
 */
export function problem(status: number, message: string, code: string, param?: string): TranslatorError;
/**
 * The error for an unknown batch, worded like the front's own.
 * @param {"anthropic" | "openai"} front - Client protocol.
 * @param {string} id - The id asked for.
 * @returns {TranslatorError} 404 `batch_not_found`.
 */
export function missing(front: "anthropic" | "openai", id: string): TranslatorError;
/**
 * The error for a Batch API that is turned off.
 * @returns {TranslatorError} 404 `batches_disabled`.
 */
export function disabled(): TranslatorError;
/**
 * Anthropic's message batch object.
 * @param {any} record - Stored batch.
 * @param {string} [base] - Origin the `results_url` is built on (`https://host`); without it the url is a path.
 * @returns {any} Message batch.
 */
export function anthropicBatch(record: any, base?: string): any;
/**
 * OpenAI's batch object.
 * @param {any} record - Stored batch.
 * @returns {any} Batch.
 */
export function openaiBatch(record: any): any;
/**
 * Anthropic's batch list, newest first: `{ data, has_more, first_id, last_id }`, `limit` 1 to 1000 (default 20), `after_id` for older batches and
 * `before_id` for newer ones.
 * @param {any[]} records - Stored batches of the front, newest first.
 * @param {{ limit?: any, before_id?: string, after_id?: string }} query - Query parameters.
 * @param {string} [base] - Origin for the `results_url`s.
 * @returns {any} List.
 * @throws {TranslatorError} 400 for a bad `limit` or a cursor that names no batch.
 */
export function anthropicList(records: any[], query: {
    limit?: any;
    before_id?: string;
    after_id?: string;
}, base?: string): any;
/**
 * OpenAI's batch list, newest first: `{ object: "list", data, first_id, last_id, has_more }`, `limit` 1 to 100 (default 20), `after` the id of the last
 * batch of the previous page.
 * @param {any[]} records - Stored batches of the front, newest first.
 * @param {{ limit?: any, after?: string }} query - Query parameters.
 * @returns {any} List.
 * @throws {TranslatorError} 400 for a bad `limit` or an `after` that names no batch.
 */
export function openaiList(records: any[], query: {
    limit?: any;
    after?: string;
}): any;
/**
 * Check a Message Batches create body and make its items.
 * @param {any} body - `{ requests: [{ custom_id, params }] }`.
 * @param {number} max - Most requests one batch may hold (`maxRequests`).
 * @returns {{ custom_id: string, request: any, outcome: null, result: null }[]} Items.
 * @throws {TranslatorError} 400 `invalid_request` naming the offending field.
 */
export function anthropicItems(body: any, max: number): {
    custom_id: string;
    request: any;
    outcome: null;
    result: null;
}[];
/**
 * Check an OpenAI create body.
 * @param {any} body - `{ input_file_id, endpoint, completion_window, metadata, output_expires_after }`.
 * @returns {{ input_file_id: string, endpoint: string, metadata: Record<string, string> | null, expiresIn: number | null }} The checked fields (`expiresIn`: seconds the output files live).
 * @throws {TranslatorError} 400 for a missing or invalid field.
 */
export function openaiParams(body: any): {
    input_file_id: string;
    endpoint: string;
    metadata: Record<string, string> | null;
    expiresIn: number | null;
};
/**
 * Read a batch input file: JSON lines of `{ custom_id, method: "POST", url, body }`. Every line is checked and the problems are listed as OpenAI lists them
 * (`code`, `message`, `line`, `param`), at most 100; blank lines are skipped. Nothing runs when a line is wrong.
 * @param {string} text - The file's text.
 * @param {string} endpoint - The batch's endpoint, which every line's `url` must be.
 * @param {number} max - Most requests one batch may hold (`maxRequests`).
 * @returns {{ items: { custom_id: string, request: { url: string, body: any }, outcome: null, result: null }[], errors: any[] }} The requests, and the problems (empty when the file is fine).
 */
export function parseInput(text: string, endpoint: string, max: number): {
    items: {
        custom_id: string;
        request: {
            url: string;
            body: any;
        };
        outcome: null;
        result: null;
    }[];
    errors: any[];
};
/**
 * The results of an ended message batch as JSON lines, in request order.
 * @param {any} record - Stored batch.
 * @returns {string} One `{ custom_id, result }` object per line.
 */
export function resultsOf(record: any): string;
/** The endpoints the OpenAI front runs a batch against. */
export const ENDPOINTS: readonly string[];
/** What a Message Batches `custom_id` looks like. */
export const CUSTOM_ID: RegExp;
import { TranslatorError } from "./errors.mjs";
