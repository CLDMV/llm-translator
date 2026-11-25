/**
 * A counting semaphore whose waits can be abandoned: the slots that bound how many batch requests run against the upstreams at once, across batches.
 * @param {number} limit - Slots.
 * @returns {{ acquire: (signal: AbortSignal) => Promise<boolean>, release: () => void }} Semaphore; `acquire` answers false when the signal aborts while it waits.
 */
export function semaphore(limit: number): {
    acquire: (signal: AbortSignal) => Promise<boolean>;
    release: () => void;
};
/**
 * The batch runner of the translator, made on first use from the `batches` setting (the global one).
 * @param {any} self - `self` of the calling leaf.
 * @param {any} context - `context` of the calling leaf.
 * @returns {any} The runner.
 * @throws {TranslatorError} 404 `batches_disabled` when `batches` is null.
 */
export function runnerOf(self: any, context: any): any;
/**
 * Find a batch of a front.
 * @param {any} runner - The runner.
 * @param {string} id - Batch id.
 * @param {"anthropic" | "openai"} front - Client protocol; a batch made through the other front is not found.
 * @returns {Promise<any>} The stored batch.
 * @throws {TranslatorError} 404 `batch_not_found`.
 */
export function find(runner: any, id: string, front: "anthropic" | "openai"): Promise<any>;
/**
 * Create a message batch and start running it.
 * @param {any} runner - The runner.
 * @param {any} body - `{ requests: [{ custom_id, params }] }`.
 * @param {string} [base] - Origin for the `results_url`.
 * @returns {Promise<any>} The message batch.
 * @throws {TranslatorError} 400 for a body that is not valid, `storage_limit_exceeded`.
 */
export function createAnthropic(runner: any, body: any, base?: string): Promise<any>;
/**
 * Create an OpenAI batch and start validating and running it.
 * @param {any} runner - The runner.
 * @param {any} files - The file store (null when the Files API is off).
 * @param {any} body - `{ input_file_id, endpoint, completion_window, metadata, output_expires_after }`.
 * @returns {Promise<any>} The batch, `validating`.
 * @throws {TranslatorError} 400 for a body that is not valid or an input file that is not there or not a batch file, 404 `files_disabled`, `storage_limit_exceeded`.
 */
export function createOpenai(runner: any, files: any, body: any): Promise<any>;
