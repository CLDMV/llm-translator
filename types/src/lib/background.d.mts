/**
 * Make a job.
 * @param {string} id - Response id.
 * @param {boolean} streaming - Whether the response was asked for with `stream: true` (its events are kept).
 * @returns {{ id: string, streaming: boolean, controller: AbortController, events: any[], done: boolean, cancelled: boolean, waiters: Set<() => void> }} Job.
 */
export function create(id: string, streaming: boolean): {
    id: string;
    streaming: boolean;
    controller: AbortController;
    events: any[];
    done: boolean;
    cancelled: boolean;
    waiters: Set<() => void>;
};
/**
 * Mark a job finished and forget the oldest finished ones. Safe to call twice.
 * @param {Map<string, any>} jobs - The translator's jobs.
 * @param {any} job - Job.
 */
export function end(jobs: Map<string, any>, job: any): void;
/**
 * Cancel a job: abort its upstream request and end it. What it had gathered is dropped.
 * @param {Map<string, any>} jobs - The translator's jobs.
 * @param {any} job - Job.
 */
export function cancel(jobs: Map<string, any>, job: any): void;
/**
 * The events of a job from the one after `after` (a `sequence_number`), then each new one, until the job ends.
 * @param {any} job - Job.
 * @param {number} [after] - `sequence_number` to start after; -1 for all.
 * @returns {AsyncGenerator<any>} Events.
 */
export function follow(job: any, after?: number): AsyncGenerator<any>;
/**
 * Run a background response to the end. Never rejects: whatever goes wrong becomes a `failed` response.
 * @param {Map<string, any>} jobs - The translator's jobs.
 * @param {any} job - Job.
 * @param {object} parts - What the run needs.
 * @param {(status: string, extra?: any) => any} parts.snapshot - The response object in a status (no output unless `extra` has it).
 * @param {(signal: AbortSignal) => Promise<any>} parts.sending - Send the request upstream; resolves to the `send` result.
 * @param {(body: any) => Promise<any>} parts.toResponse - Convert a non-streaming upstream body to the response object.
 * @param {(source: AsyncIterable<any>) => AsyncIterable<any>} parts.toEvents - Convert an upstream stream to Responses events.
 * @param {(response: any) => Promise<void>} parts.save - Keep the response (its progress, and its end).
 * @returns {Promise<void>} Resolves when the job is over.
 */
export function run(jobs: Map<string, any>, job: any, { snapshot, sending, toResponse, toEvents, save }: {
    snapshot: (status: string, extra?: any) => any;
    sending: (signal: AbortSignal) => Promise<any>;
    toResponse: (body: any) => Promise<any>;
    toEvents: (source: AsyncIterable<any>) => AsyncIterable<any>;
    save: (response: any) => Promise<void>;
}): Promise<void>;
