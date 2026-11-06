/**
 * Fastify plugin. Anthropic front: `POST /v1/messages`, `POST /v1/messages/count_tokens`, `GET /v1/models`, `GET /v1/models/{id}`,
 * `GET|HEAD /` and `/api/hello`. OpenAI front: `POST /v1/chat/completions`, `GET /v1/models`, `GET /v1/models/{id}`, `GET|HEAD /`. Responses stream as
 * `text/event-stream` with keep-alive pings; a client disconnect aborts the upstream request. Register it with
 * `app.register(api.server.plugin, { apiKey })`. `authorize(request)` (sync or async) runs after `apiKey` and the body parse and decides
 * with `true` / `{ ok: true, context }` or `false` / `{ ok: false, status, message }`; `onUsage(report, context)` receives each request's usage report. When the Fastify `logger` is enabled, events also go to it as structured lines (`{ event }` plus the message), through the request's logger for events of a request.
 * @param {any} fastify - Fastify instance.
 * @param {any} [options] - `{ front, apiKey, bodyLimit, authorize, onUsage }`. `authorize(request)` and `onUsage(report, context)` are described above. `front` sets the protocol this plugin instance serves (default: the translator's front, other plugin instances and `api.send` are unaffected); `apiKey` (string or array) is required from clients. Forwarded OpenAI bodies are restricted to known fields unless the `passthroughFilter` setting is `false`.
 * @returns {Promise<void>} Resolves once the routes are registered.
 */
export function plugin(fastify: any, options?: any): Promise<void>;
