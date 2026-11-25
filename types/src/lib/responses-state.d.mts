/**
 * A client error.
 * @param {number} status - HTTP status.
 * @param {string} message - Message.
 * @param {string} code - Error code.
 * @param {string | null} [param] - Offending parameter.
 * @returns {TranslatorError} Error.
 */
export function problem(status: number, message: string, code: string, param?: string | null): TranslatorError;
/**
 * The translator's response store and its `responses` setting, made on first use (the global setting; an upstream's own `settings` do not apply to a
 * store the fronts share).
 * @param {any} config - Translator config.
 * @param {any} state - Translator state (holds the store).
 * @returns {{ store: ReturnType<typeof create>, options: import("./responses-store.mjs").ResponsesSetting } | null} The store, or null when `responses` is null (stateful features are off).
 */
export function stateOf(config: any, state: any): {
    store: ReturnType<typeof create>;
    options: import("./responses-store.mjs").ResponsesSetting;
} | null;
/**
 * The stateful Responses API's store, or the error that says it is off.
 * @param {any} config - Translator config.
 * @param {any} state - Translator state.
 * @returns {{ store: ReturnType<typeof create>, options: import("./responses-store.mjs").ResponsesSetting }} The store and its setting.
 * @throws {TranslatorError} 404 `responses_disabled` when `responses` is null.
 */
export function required(config: any, state: any): {
    store: ReturnType<typeof create>;
    options: import("./responses-store.mjs").ResponsesSetting;
};
/**
 * The background jobs of a translator (running ones, and finished ones whose event stream can still be read), by response id.
 * @param {any} state - Translator state.
 * @returns {Map<string, any>} Jobs.
 */
export function jobsOf(state: any): Map<string, any>;
/**
 * The error for an unknown response.
 * @param {string} id - The id asked for.
 * @returns {TranslatorError} 404 `response_not_found`.
 */
export function missing(id: string): TranslatorError;
/**
 * The response object of a stored record. A background response that is still queued or in progress, but has no job left to finish it (the process
 * restarted with a directory store), is reported as failed.
 * @param {any} record - Stored record.
 * @param {any} state - Translator state.
 * @returns {any} Response object.
 */
export function viewOf(record: any, state: any): any;
/**
 * Input items with ids: a string is one user message; a message with string content gets its content parts; an item without an id gets one; messages
 * and function calls get `status: "completed"`. The input is not changed.
 * @param {string | any[]} input - The `input` of a request, or the `items` of a conversation call.
 * @param {string} [at] - Path of the list, for errors.
 * @returns {any[]} Items.
 * @throws {TranslatorError} 400 `invalid_request` for an item that is not an object, `unsupported_content` for a type a history cannot hold.
 */
export function itemsOf(input: string | any[], at?: string): any[];
/**
 * One page of a list of items kept oldest first.
 * @param {any[]} items - Items, oldest first.
 * @param {{ limit?: any, order?: string, after?: string, before?: string }} [query] - Query parameters as the client sent them.
 * @param {"asc" | "desc"} [fallback] - Order when the query has none.
 * @returns {{ object: "list", data: any[], first_id: string | null, last_id: string | null, has_more: boolean }} The list object.
 * @throws {TranslatorError} 400 for a bad `limit` or `order`, 404 `item_not_found` when `after` or `before` names no item.
 */
export function listOf(items: any[], query?: {
    limit?: any;
    order?: string;
    after?: string;
    before?: string;
}, fallback?: "asc" | "desc"): {
    object: "list";
    data: any[];
    first_id: string | null;
    last_id: string | null;
    has_more: boolean;
};
/**
 * The items a conversation holds after more are added to the end.
 * @param {any[]} held - Items it holds, oldest first.
 * @param {any[]} items - Items to add, with ids.
 * @param {number} max - Most items a conversation holds (`maxItems`).
 * @param {boolean} trim - True to drop the oldest items that do not fit (a response's items must be kept); false to refuse items that do not fit or that it already holds.
 * @returns {any[]} The items.
 * @throws {TranslatorError} 400 `conversation_full` when `trim` is false and the items do not fit, 400 `item_exists` for an id the conversation holds (or the batch repeats).
 */
export function fit(held: any[], items: any[], max: number, trim: boolean): any[];
/**
 * Add items to the end of a conversation.
 * @param {ReturnType<typeof create>} store - The store.
 * @param {number} max - Most items a conversation holds (`maxItems`).
 * @param {string} id - Conversation id.
 * @param {any[]} items - Items with ids.
 * @param {boolean} trim - See {@link fit}.
 * @returns {Promise<any | null>} The conversation record, or null when there is none.
 * @throws {TranslatorError} As {@link fit}.
 */
export function append(store: ReturnType<typeof create>, max: number, id: string, items: any[], trim: boolean): Promise<any | null>;
/**
 * Resolve the stateful parts of a Responses request. Without a store (the `responses` setting is null) nothing is resolved and the request converter
 * refuses the stateful fields as it always did. With one, `previous_response_id` and `conversation` become the history items to put before the
 * request's own input, and `store`, `background`, `previous_response_id` and `conversation` leave the body the converter sees.
 * @param {any} body - Client body.
 * @param {{ config: any, state: any }} context - Translator config and state.
 * @returns {Promise<null | { id: string, body: any, history: any[], input: any, store: boolean, background: boolean, previous: string | null, conversation: string | null, echo: any }>} The plan, or null for a stateless request.
 * @throws {TranslatorError} 400 for a malformed parameter, both `previous_response_id` and `conversation`, a previous response that is unknown or unfinished, `background` without `store`; 404 `conversation_not_found`.
 */
export function plan(body: any, { config, state }: {
    config: any;
    state: any;
}): Promise<null | {
    id: string;
    body: any;
    history: any[];
    input: any;
    store: boolean;
    background: boolean;
    previous: string | null;
    conversation: string | null;
    echo: any;
}>;
/**
 * The request body to convert once the history is known: the body without the stateful fields, with the history items before the request's own
 * input items.
 * @param {NonNullable<Awaited<ReturnType<typeof plan>>>} made - The request's plan.
 * @returns {any} Body.
 */
export function joined(made: NonNullable<Awaited<ReturnType<typeof plan>>>): any;
/**
 * Keep a background response that was just accepted (`queued`), so it can be retrieved and cancelled while it runs.
 * @param {NonNullable<Awaited<ReturnType<typeof plan>>>} made - The request's plan.
 * @param {any} response - The queued response object.
 * @param {{ config: any, state: any }} context - Translator config and state.
 * @returns {Promise<void>} Resolves when kept.
 */
export function begin(made: NonNullable<Awaited<ReturnType<typeof plan>>>, response: any, { config, state }: {
    config: any;
    state: any;
}): Promise<void>;
/**
 * Record the progress of a background response (`in_progress`), unless it was cancelled or deleted meanwhile.
 * @param {string} id - Response id.
 * @param {any} response - The response object in its new status.
 * @param {{ config: any, state: any }} context - Translator config and state.
 * @returns {Promise<void>} Resolves when kept.
 */
export function progress(id: string, response: any, { config, state }: {
    config: any;
    state: any;
}): Promise<void>;
/**
 * Keep a response, and add its input and output items to its conversation. Nothing is kept for `store: false`. A background response replaces its
 * queued record, unless it was cancelled or deleted meanwhile (then the result is dropped). A conversation only takes the items of a response that
 * finished (`completed` or `incomplete`).
 * @param {NonNullable<Awaited<ReturnType<typeof plan>>>} made - The request's plan.
 * @param {any} response - The finished response object.
 * @param {{ config: any, state: any }} context - Translator config and state.
 * @returns {Promise<void>} Resolves when kept.
 */
export function finish(made: NonNullable<Awaited<ReturnType<typeof plan>>>, response: any, { config, state }: {
    config: any;
    state: any;
}): Promise<void>;
/**
 * Cancel a background response: its job is stopped (the upstream request is aborted) and the stored response gets the status `cancelled`. A response
 * that is not running any more (finished, failed, cancelled before, or left without a job by a restart) is returned as it is.
 * @param {ReturnType<typeof create>} store - The store.
 * @param {any} state - Translator state.
 * @param {string} id - Response id.
 * @returns {Promise<any>} Response object.
 * @throws {TranslatorError} 404 `response_not_found`, 400 `not_background` for a response that was not made with `background: true`.
 */
export function halt(store: ReturnType<typeof create>, state: any, id: string): Promise<any>;
/** Statuses of a response that is still being produced (background mode). */
export const LIVE: readonly string[];
import { TranslatorError } from "./errors.mjs";
import { create } from "./responses-store.mjs";
