/**
 * Events for a stream reply committed before the upstream answered: the upstream's stream when it accepted, else its error
 * as a final error event (the HTTP status is already 200, so the error travels in-band).
 * @param {Promise<any>} sending - Pending `send` result.
 * @param {any} api - Captured translator parts.
 * @param {string} [model] - Model the client asked for (used in the early `message_start`).
 * @param {(source: AsyncIterable<any>) => AsyncIterable<any>} [convert] - Turns the upstream's stream into the client's events (the Responses front).
 * @returns {AsyncGenerator<any>} Client events.
 */
export function late(sending: Promise<any>, api: any, model?: string, convert?: (source: AsyncIterable<any>) => AsyncIterable<any>): AsyncGenerator<any>;
/**
 * Register the routes for one front on a Fastify instance.
 * @param {any} fastify - Fastify instance (usually an encapsulated plugin scope).
 * @param {any} options - `{ apiKey, bodyLimit, authorize, onUsage, metrics, cors, rateLimit }`.
 * @param {any} captured - Captured translator parts `{ front, interval(body), filter, send, route, count, list, get, build, encode, write }`; `front` applies to this instance only.
 * @returns {void}
 */
export function register(fastify: any, options: any, captured: any): void;
