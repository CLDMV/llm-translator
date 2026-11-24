# Server and CLI

The translator can run as a standalone HTTP server, as a Fastify plugin inside an existing app, or be wired into any other server using the helper leaves. Fastify is an optional peer dependency: install it (`npm install fastify`) to use `server.start` or `server.plugin`.

## Fronts and routes

The server speaks one client protocol, the front, chosen with `front` (default `anthropic`).

| Front       | Routes                                                                                                                                                                                                                                  |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `anthropic` | `POST /v1/messages`, `POST /v1/messages/count_tokens`, the [Files API](#files-api), [Message Batches](#message-batches), `GET /v1/models`, `GET /v1/models/{id}`, `GET` and `HEAD` on `/` and `/api/hello`                              |
| `openai`    | `POST /v1/chat/completions`, `POST /v1/responses`, `POST /v1/responses/input_tokens`, `POST /v1/embeddings`, the [Files API](#files-api), the [Batch API](#batch-api), `GET /v1/models`, `GET /v1/models/{id}`, `GET` and `HEAD` on `/` |

Streaming replies use `content-type: text/event-stream`. Errors are always returned in the front's own error shape.

### Responses

`POST /v1/responses` (OpenAI front only) accepts an OpenAI Responses API request and answers with a Responses object, or with semantic stream events when `stream` is true. It is stateless: the request is converted to a Chat Completions body, sent through the normal path (any upstream protocol, pools, failover, `apiKey`, `authorize`, `onUsage`, metrics and capture all apply) and the reply is converted back, so the same upstreams that serve `/v1/chat/completions` serve it. `authorize` sees the Responses body as the client sent it, with the routed model.

`POST /v1/responses/input_tokens` answers `{ "object": "response.input_tokens", "input_tokens": n }` for the same request shape, counted like `count_tokens`.

Text and image input, `instructions`, function tools, `tool_choice`, `parallel_tool_calls`, `text.format` (`json_object`, `json_schema`), `reasoning.effort`, `max_output_tokens`, usage and `incomplete_details` are mapped. A request that needs state or hosted features is refused with a 400 in the OpenAI error shape (`error.code` `unsupported_field`, `unsupported_tool` or `unsupported_content`, and `error.param` naming the field): `previous_response_id`, `conversation`, `store: true`, `background: true`, stored prompts, hosted tools (web search, file search, code interpreter, computer use, MCP, image generation, shell, custom tools), `item_reference` and the hosted `*_call` input items. Fields with no mapping (`top_logprobs`, `max_tool_calls`, `truncation: "auto"`, unknown fields) are dropped and reported in a `dropped` event, or refused under `unknownFields: "error"`. Every mapped and unmapped parameter is listed in [protocol-support.md](protocol-support.md#8-responses-api-front).

A stream starts with `response.created` and `response.in_progress` and ends with `response.completed`, `response.incomplete` or `response.failed`; there is no `[DONE]` line. Pings are SSE comments, and a request whose upstream is slow to answer is committed to a stream early (see [Pings and early commit](#pings-and-early-commit)); if the upstream then fails, the stream is one `error` event.

Reasoning from the upstream is returned as a `reasoning` item with a summary part. With `reasoningRoundTrip` on, the item also carries `encrypted_content`, an opaque value the client sends back with the item so the upstream gets its reasoning on the next turn (needed for Anthropic upstreams with tools); without it, reasoning items in the input are dropped.

### Embeddings

`POST /v1/embeddings` (OpenAI front only; also `api.embeddings.send(body, { signal, headers })` as a library call) forwards the request to an OpenAI-protocol upstream that lists the model. The body and the reply pass through unchanged, except that `model` is replaced by the upstream's name for it after `aliases`. Routing, pools and failover work as for chat (a connection error or a 5xx moves on to the next endpoint serving the model), `apiKey` and `authorize` apply, and `authorize` sees the routed model. Errors use the OpenAI shape:

| Case                                                            | Status  | `error.code`              |
| --------------------------------------------------------------- | ------- | ------------------------- |
| Body is not an object, or `model` is missing                    | 400     | `invalid_body`            |
| No upstream lists the model (there is no single-model fallback) | 404     | `model_not_found`         |
| The model is served only by Anthropic-protocol upstreams        | 400     | `embeddings_unsupported`  |
| Every upstream is unreachable                                   | 502     | `upstream_unreachable`    |
| The upstream refused it                                         | as sent | the upstream's own `code` |

Anthropic-protocol endpoints in a pool are skipped. Embeddings are not streamed. Their usage goes through `onUsage` like chat usage does (see [usage reporting](#usage-reporting-and-model-allow-lists)).

### Files API

Both fronts serve `/v1/files` from one store, so a file uploaded through either front can be referenced by either (see [Files](protocol-support.md#24-files-a-to-o-and-o-to-a) for how references are read, and the [`files` setting](settings.md#files) for the store and its limits). Uploads are `multipart/form-data` with a `file` part, read by the translator itself (no extra dependency). The routes sit behind the same API key and `authorize` hook as every other route. The Fastify body limit for the upload route is the file size limit plus 1 MiB.

| Route                        | Anthropic front                                                                                                                                                                                                                                                                                                                   | OpenAI front                                                                                                                                                                                                                                                                                              |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /v1/files`             | `file`, optional `expires_in_seconds` (3600 to 7776000). Answers `{ id: "file_...", type: "file", filename, mime_type, size_bytes, created_at, downloadable: false, expires_at }`                                                                                                                                                 | `file`, `purpose` (required: `assistants`, `batch`, `fine-tune`, `vision`, `user_data`, `evals`), optional `expires_after[anchor]` (`created_at`) and `expires_after[seconds]` (3600 to 2592000). Answers `{ id: "file-...", object: "file", bytes, created_at, filename, purpose, status, expires_at? }` |
| `GET /v1/files`              | `{ data, next_page }`: `limit` (20, at most 1000), `page` (the `next_page` of the previous page), or up to 100 `ids[]` (not with `page` or `limit`; unknown ids are left out). With `anthropic-beta: files-api-2025-04-14`: `{ data, has_more, first_id, last_id }` with `before_id` and `after_id`, and no `expires_at` on files | `{ object: "list", data, first_id, last_id, has_more }`: `purpose`, `limit` (10000), `after`, `order` (`desc` default, or `asc`)                                                                                                                                                                          |
| `GET /v1/files/{id}`         | the file object                                                                                                                                                                                                                                                                                                                   | the file object                                                                                                                                                                                                                                                                                           |
| `GET /v1/files/{id}/content` | 400 `not_downloadable`: every stored file was uploaded, and Anthropic only lets a client download what its tools or skills created                                                                                                                                                                                                | the bytes, with the stored media type                                                                                                                                                                                                                                                                     |
| `DELETE /v1/files/{id}`      | `{ id, type: "file_deleted" }`                                                                                                                                                                                                                                                                                                    | `{ id, object: "file", deleted: true }`                                                                                                                                                                                                                                                                   |

An unknown or expired id is a 404 (`not_found_error` on the Anthropic front; on the OpenAI front `invalid_request_error`, "No such File object: id"). A file name must be 1 to 255 characters without `< > : " | ? * \ /` or control characters (Anthropic's rule). A file over `files.maxFileSize` is 413 (`request_too_large`), and a store at `files.maxCount` or `files.maxTotalBytes` answers 400 `storage_limit_exceeded`. With `files: null` every route answers 404 `files_disabled`. The same operations are the leaves `api.files.create`, `list`, `get`, `content` and `remove`, for your own server.

### Message Batches

The Anthropic front serves Message Batches. A batch is made with a list of requests and runs in the background, in this process, through the same path as `POST /v1/messages`, so every upstream and every conversion works. At most `batches.concurrency` requests are in flight at once, counted across all batches (see the [`batches` setting](settings.md#batches)). Streaming is not available in a batch: a request that sets `stream: true` gets an `errored` result.

| Route                                   | Answers                                                                                                                                                                                                                                                                                                 |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /v1/messages/batches`             | `{ requests: [{ custom_id, params }] }`; `custom_id` is 1 to 64 letters, digits, `-` or `_` and unique in the batch. Answers the message batch: `{ id: "msgbatch_...", type: "message_batch", processing_status, request_counts, ended_at, created_at, expires_at, cancel_initiated_at, results_url }`. |
| `GET /v1/messages/batches`              | `{ data, has_more, first_id, last_id }`, newest first: `limit` (20, at most 1000), `after_id` (older) and `before_id` (newer).                                                                                                                                                                          |
| `GET /v1/messages/batches/{id}`         | the message batch. `processing_status` is `in_progress`, `canceling` or `ended`; `request_counts` has `processing`, `succeeded`, `errored`, `canceled` and `expired`; `results_url` is set once the batch has ended.                                                                                    |
| `POST /v1/messages/batches/{id}/cancel` | the batch as `canceling`. Requests in flight are aborted and the ones that did not run end as `canceled`. Cancelling a batch that has ended is a 400.                                                                                                                                                   |
| `DELETE /v1/messages/batches/{id}`      | `{ id, type: "message_batch_deleted" }`. A batch that has not ended is a 400.                                                                                                                                                                                                                           |
| `GET /v1/messages/batches/{id}/results` | `application/x-jsonl`, one `{ custom_id, result }` per line in request order; `result.type` is `succeeded` (with `message`), `errored` (with `error`), `canceled` or `expired`. A batch that has not ended is a 400.                                                                                    |

A batch that has not finished by `expires_at` (a day after it was made, the `batches.window` setting) ends with its remaining requests `expired`. Results are kept for the `batches.ttl` retention, 29 days by default; after that the batch is a 404.

### Batch API

The OpenAI front serves `/v1/batches` for the `/v1/chat/completions`, `/v1/responses` and `/v1/embeddings` endpoints. The input is a file in the [Files API](#files-api) uploaded with `purpose: "batch"`, with one `{ "custom_id", "method": "POST", "url", "body" }` object per line, where `url` is the batch's endpoint. The results are written to two files when the batch ends, `output_file_id` (purpose `batch_output`) and `error_file_id` (purpose `batch_error`), read through `GET /v1/files/{id}/content`. A request that was answered with 2xx or 3xx is a line of the output file `{ id: "batch_req_...", custom_id, response: { status_code, request_id, body }, error: null }`; any other reply is the same line in the error file; a request that never ran (cancelled or expired) is a line in the error file with `response: null` and `error: { code: "batch_cancelled" | "batch_expired", message }`.

| Route                          | Answers                                                                                                                                                                                                                                                  |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /v1/batches`             | `{ input_file_id, endpoint, completion_window: "24h", metadata, output_expires_after }`. Answers the batch object with `status: "validating"`. A missing or invalid field, an input file that does not exist or is not a `batch` file, is a 400.         |
| `GET /v1/batches`              | `{ object: "list", data, first_id, last_id, has_more }`, newest first: `limit` (20, at most 100) and `after`.                                                                                                                                            |
| `GET /v1/batches/{id}`         | the batch object: `status` (`validating`, `failed`, `in_progress`, `finalizing`, `completed`, `expired`, `cancelling`, `cancelled`), the `*_at` times in seconds, `request_counts` (`total`, `completed`, `failed`), `usage`, `errors` and the file ids. |
| `POST /v1/batches/{id}/cancel` | the batch as `cancelling`; it becomes `cancelled` once the requests in flight were aborted. Cancelling a batch that has ended is a 409.                                                                                                                  |

The input file is checked as a whole before anything runs. When a line is wrong the batch ends `failed` with `errors: { object: "list", data: [{ code, message, line, param }] }` (at most 100 entries; `invalid_json_line`, `invalid_request`, `duplicate_custom_id`, `invalid_method`, `invalid_url`, `empty_file`, `too_many_tasks`) and no request runs. A batch that is not finished at `expires_at` ends `expired`. `usage` adds up the tokens the upstreams reported.

A batch belongs to the front it was made through: the other front gets a 404 for its id and does not list it. Both routes answer 404 `batches_disabled` when `batches` is `null`.

## CLI

```bash
llm-translator --front anthropic --upstream http://gpu-box:8000 --port 8787
```

| Flag                                  | Environment variable                            | Meaning                                                                        |
| ------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------ |
| `--front`                             | `LLM_TRANSLATOR_FRONT`                          | `anthropic` (default) or `openai`                                              |
| `--upstream <url>` (repeatable)       | `LLM_TRANSLATOR_UPSTREAM` (comma separated)     | upstream base URL                                                              |
| `--upstream-key`                      | `LLM_TRANSLATOR_UPSTREAM_KEY`                   | key sent to the upstream                                                       |
| `--backend`                           | `LLM_TRANSLATOR_BACKEND`                        | driver name instead of auto-detection                                          |
| `--model alias=target` (repeatable)   |                                                 | model alias                                                                    |
| `--host`                              | `LLM_TRANSLATOR_HOST`                           | listen address, default `127.0.0.1`                                            |
| `--port`                              | `LLM_TRANSLATOR_PORT`                           | listen port, default `8787`                                                    |
| `--api-key`                           | `LLM_TRANSLATOR_API_KEY`                        | key clients must send                                                          |
| `--config <file>`                     | `LLM_TRANSLATOR_CONFIG`                         | JSON config file                                                               |
| `--allow-unauthenticated`             | `LLM_TRANSLATOR_ALLOW_UNAUTHENTICATED=1`        | allow a non-loopback `--host` without `--api-key`                              |
| `--metrics`                           | `LLM_TRANSLATOR_METRICS=1`                      | serve Prometheus metrics at `GET /metrics`, see [metrics](#prometheus-metrics) |
| `--tls-key <file>`                    | `LLM_TRANSLATOR_TLS_KEY`                        | TLS private key (PEM); with `--tls-cert` the server speaks HTTPS               |
| `--tls-cert <file>`                   | `LLM_TRANSLATOR_TLS_CERT`                       | TLS certificate (PEM)                                                          |
| `--tls-ca <file>`                     | `LLM_TRANSLATOR_TLS_CA`                         | extra CA certificate (PEM)                                                     |
| `--tls-passphrase <text>`             | `LLM_TRANSLATOR_TLS_PASSPHRASE`                 | passphrase of the TLS key                                                      |
| `--cors-origin <origin>` (repeatable) | `LLM_TRANSLATOR_CORS_ORIGINS` (comma separated) | origin browsers may call from (`*` for any)                                    |
| `--rate-limit <n>`                    | `LLM_TRANSLATOR_RATE_LIMIT`                     | requests allowed per window for each API key                                   |
| `--rate-limit-window <ms>`            | `LLM_TRANSLATOR_RATE_LIMIT_WINDOW`              | rate limit window, default `60000`                                             |
| `--logs [path]`                       |                                                 | log to the console (the default), or append JSON lines to `path`               |
| `--silent`                            |                                                 | same as `logs: false`: no console output, no file                              |
| `--no-detect`                         |                                                 | skip detection                                                                 |

The CLI logs warnings and errors to the console by default (`logs: true`); `--logs path` writes every event to a file instead and `--silent` turns logging off. A config file can set `logs` (or the deprecated `silent`). See [events.md](events.md).

Flags win over environment variables, which win over the config file. The config file is a translator config plus an optional `server` object:

```json
{
	"front": "anthropic",
	"upstreams": [{ "name": "gpu", "url": "http://gpu-box:8000", "models": ["qwen3-coder"], "default": true }],
	"aliases": { "claude-opus-5-5": "qwen3-coder" },
	"settings": { "pingInterval": 10000 },
	"server": { "host": "0.0.0.0", "port": 8787, "apiKey": "change-me" }
}
```

The process runs until SIGINT or SIGTERM, then closes the server and the translator.

### Aliases that pin settings

Claude Code asks for tier names (`ANTHROPIC_DEFAULT_{FABLE,OPUS,SONNET,HAIKU}_MODEL`). With one local model the tiers can map to the same model at different efforts:

```json
{
	"aliases": {
		"glm-flash-max": { "model": "GLM-5.3-Flash", "effort": "max" },
		"glm-flash-high": { "model": "GLM-5.3-Flash", "effort": "high" },
		"glm-flash-low": { "model": "GLM-5.3-Flash", "effort": "low" },
		"glm-flash-plain": "GLM-5.3-Flash"
	},
	"efforts": { "GLM-5.3-Flash": ["low", "high", "max"] }
}
```

`GET /v1/models` and `GET /v1/models/{id}` list the alias names next to the real models. In both client shapes an entry adds these fields when they apply:

| Field            | On                             | Meaning                                                                                                     |
| ---------------- | ------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| `efforts`        | a model with an `efforts` list | The supported levels, lowest to highest. An alias that pins an effort lists just that one (after snapping). |
| `default_effort` | the same entries               | The level sent when the request names none, or `null` when the model's own default applies.                 |
| `alias_of`       | every alias                    | The model name the alias points at.                                                                         |
| `effort`         | an alias that pins an effort   | The pinned level, after snapping to the model's list.                                                       |
| `thinking`       | an alias that pins `thinking`  | `true` or `false`. An alias that turns thinking off has no `efforts`.                                       |

## Authentication

Listening on anything other than a loopback address (`127.x`, `::1`, `localhost`) requires an `apiKey` or an `authorize` hook: the start-up is refused otherwise, because anyone who can reach the port could spend your GPU. Pass `--allow-unauthenticated` (`allowUnauthenticated: true`) to opt out, for example behind a trusted network or an authenticating reverse proxy.

`apiKey` (a string or an array) makes the server require the key as `x-api-key` or `Authorization: Bearer <key>` on the API routes. `/` and `/api/hello` stay open. Upstream keys are configured separately on each upstream and never reach the client.

### `authorize` hook and `onUsage`

An app with its own key system passes `authorize(request)` (sync or async) to `server.start` or `server.plugin` instead of rebuilding the routes. It runs on the API routes after the `apiKey` check (when one is set) and after the body is parsed; `/` and `/api/hello` skip it.

```js
const server = await api.server.start({
	host: "0.0.0.0",
	authorize: async (request) => {
		const key = await keys.lookup(request.headers["x-api-key"]);
		if (!key) return { ok: false, status: 401, message: "invalid key" };
		if (request.method === "POST" && !request.route) return { ok: false, status: 400, message: "unroutable request" };
		if (request.route && !key.models.includes(request.route.model)) return { ok: false, status: 403, message: "model not allowed" };
		return { ok: true, context: { keyId: key.id } };
	},
	onUsage: (report, context) => meter.add(context?.keyId, report)
});
```

`request` is `{ method, url, headers, body, front, route }`. `body` is the parsed body (`undefined` for `GET`). `route` is the result of `api.route(body)` (see below) for every object body, with or without a `model` (a body without one is routed like `request` routes it, which may substitute the only model an upstream serves). `route` is `null` only for a body that is not an object or cannot be routed; the normal handler then answers it with a 400. A hook that enforces a model allow-list should therefore refuse a `POST` whose `request.route` is `null`, as the example above does.

| Return value                                 | Result                                                                                                                                                                         |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `true`, `{ ok: true, context?, cacheSalt? }` | The request proceeds; `context` is kept for `onUsage`, and `cacheSalt` (a non-empty string) is sent to a vLLM upstream as `cache_salt`, see [prompt caching](#prompt-caching). |
| `false`, `{ ok: false, status?, message? }`  | Refused; defaults are status `401`, message `unauthorized`.                                                                                                                    |
| anything else                                | Refused with `401`.                                                                                                                                                            |
| a thrown or rejected hook                    | Refused with `401`; the error goes to the request logger.                                                                                                                      |

A refusal is delivered through `api.error.build`, so each front gets its own error format (Anthropic `{"type":"error",…}`, OpenAI `{"error":{…}}`). `onUsage(report, context)` is called once per request with the usage report described under [usage reporting](#usage-reporting-and-model-allow-lists) and the `context` the hook returned (`undefined` without a hook); it also works without `authorize`. With `authorize` set, a non-loopback bind no longer needs an `apiKey`.

## Prometheus metrics

`GET /metrics` serves Prometheus metrics in the text exposition format (version 0.0.4, `content-type: text/plain; version=0.0.4; charset=utf-8`). It is off by default and then an unknown route (404 like any other). Turn it on with `--metrics`, `LLM_TRANSLATOR_METRICS=1`, `"server": { "metrics": true }` in the config file, or the `metrics: true` option of `server.start` and `server.plugin`. There is no dependency: the registry is built in.

`/metrics` follows the server's authentication like every other route except `/` and `/api/hello`: with an `apiKey` the scraper must send it (`x-api-key`, or `authorization: Bearer <key>`, which Prometheus supports through `authorization.credentials`), and an `authorize` hook runs for it too (`request.url` is `/metrics`, `request.body` is undefined). With neither, the endpoint is open, which is only possible on a loopback address or with `allowUnauthenticated`. The counters live in memory per server and reset when the process restarts.

| Metric                                    | Type      | Labels                             | Meaning                                                                                                                                                                                                                                      |
| ----------------------------------------- | --------- | ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `llm_translator_requests_total`           | counter   | `front`, `route`, `driver`, `code` | Requests handled, counted when the response ends                                                                                                                                                                                             |
| `llm_translator_request_duration_seconds` | histogram | `front`, `route`, `driver`, `code` | Seconds from the request arriving to the end of the response, streams included. Buckets 5 ms to 300 s                                                                                                                                        |
| `llm_translator_tokens_total`             | counter   | `driver`, `type`                   | Tokens the upstream reported: `type` is `input`, `output`, `cache_read` or `cache_creation` (from the normalised usage report)                                                                                                               |
| `llm_translator_errors_total`             | counter   | `kind`                             | Failed requests: `upstream` (the upstream answered with an error or was unreachable), `translator` (an internal failure, a 5xx of our own, or an error event inside a stream) and `client` (a refused request: bad body, key, unknown model) |
| `llm_translator_upstream_up`              | gauge     | `upstream`, `driver`               | `1` while the upstream is healthy (not backing off after a failure and not reported not ready by its probe), else `0`                                                                                                                        |

Labels are bounded. `front` is `anthropic` or `openai`, `route` is the route pattern (`/v1/messages`, `/v1/models/*`, with the plugin prefix when there is one) and never the URL, `driver` is the driver of the upstream that answered (`vllm`, `openai`, ...) or `none` when no upstream was reached, `upstream` is the configured upstream name, and `code` is the HTTP status. The model a client asked for, request ids and API keys are never labels. A client that left before the response finished is counted with `code="499"` and is not an error. A stream that fails after it started has `code="200"` (the status was already sent) and counts in `llm_translator_errors_total`. Requests to paths that match no route are not counted, and neither are the scrapes themselves.

## TLS, rate limits and CORS

All three are off by default, so a plain `llm-translator --upstream ...` behaves as before. They are `server.start` options (and `server` keys in the config file); `cors` and `rateLimit` are also options of the Fastify plugin, while TLS belongs to the server that `start` creates.

```json
{
	"server": {
		"host": "0.0.0.0",
		"apiKey": "change-me",
		"tls": { "key": "/etc/llm-translator/key.pem", "cert": "/etc/llm-translator/cert.pem" },
		"rateLimit": { "requests": 60, "windowMs": 60000 },
		"cors": ["https://app.example.com"]
	}
}
```

**TLS.** `tls: { key, cert, ca, passphrase }` takes file paths (`ca` may be a list) and makes `start` create an HTTPS server instead of an HTTP one; the handle's `url` then starts with `https://`. `key` and `cert` go together: start-up fails with an `invalid_config` error when only one of them is set, when a file cannot be read (the message names the option and path), or when a value has the wrong type. Files are read once at start. There is no reload, no HTTP to HTTPS redirect and no listener on a second port.

**Rate limit.** `rateLimit: { requests, windowMs = 60000 }` allows that many requests per fixed window for each client. A client is the API key it sent when that key is one of the configured `apiKey` values, and its remote address otherwise: no key, a wrong key, or no `apiKey` configured at all (a made-up key never earns a fresh bucket). Over the limit the server answers 429 in the error format of the front the request came in on (`rate_limit_error` on the Anthropic front) with a `retry-after` header in whole seconds, before any upstream is contacted. `GET /`, `/api/hello`, `GET /metrics` and CORS preflights are not counted, so a scraper cannot be locked out. With `metrics` on, a request refused with 429 is counted like any other, under `code="429"`; a preflight is not an API request and stays out of the counters. The counters are in memory and per process, so several server processes each apply the limit on their own. Buckets of clients that went quiet are dropped as requests arrive, at most once per window, so memory follows the number of clients seen in the last window or two and there is no timer to clear on stop. Behind a reverse proxy every request has the proxy's address, so run the limit with `apiKey` clients or enforce it at the proxy.

**CORS.** `cors` is a list of allowed origins (`["https://app.example.com"]`, or `{ origins: [...] }`); `"*"` allows any origin. Origins are compared exactly, ignoring case and a trailing slash. A request from an allowed origin gets `access-control-allow-origin` (the origin itself, or `*`) and `access-control-expose-headers` on every reply, errors, 401 and 429 and streams included, so the browser can read them. An `OPTIONS` preflight is answered with 204, `access-control-allow-methods: GET, HEAD, POST, OPTIONS`, the headers the browser asked for in `access-control-request-headers` (`authorization, x-api-key, content-type, anthropic-version, anthropic-beta` when it did not ask) and `access-control-max-age: 600`, without an API key and outside the rate limit. A disallowed origin gets no CORS headers, so the browser refuses the reply, but the server does not reject the request, and a request without an `Origin` header (curl, server-side callers) is never touched. `vary: origin` is added whenever the request has an `Origin`. Unknown paths (the 404 handler of `server.start`) carry no CORS headers.

## Prompt caching

The translator does not cache anything itself. What is cached, and how it is reported, depends on the upstream server, and the translator's part is limited to a few hints and to reading usage.

**What is not mapped.** Anthropic's `cache_control` markers (and their TTLs) have no equivalent on an OpenAI-protocol server and are dropped. `cache_creation_input_tokens` is always 0 in converted replies, because Chat Completions servers do not report cache writes. Cache reads are reported only when the server exposes `usage.prompt_tokens_details.cached_tokens` (vLLM needs `--enable-prompt-tokens-details`): they become `cache_read_input_tokens` and are subtracted from `input_tokens`.

**What the servers cache.** vLLM caches prompt prefixes automatically when prefix caching is on, with no request field needed; any request that begins with the same tokens as an earlier one can reuse its blocks. OpenAI caches long prompt prefixes automatically too. The hints below only steer or isolate that cache.

**`cache_salt` (vLLM).** vLLM mixes the salt into the hash of the first cache block, so requests with different salts never share cached prefixes. This isolates tenants from each other (a cache hit can otherwise be observed as a latency difference). The salt is a server-side control and is never read from a client: the OpenAI front's `passthroughFilter` strips a `cache_salt` field and the Anthropic front has no such field. It comes from, in order of precedence:

1. the `cacheSalt` option of `request` / `send` (programmatic callers), which the server fills from the `cacheSalt` an `authorize` hook returns with `{ ok: true }`;
2. the upstream's `cacheSalt` setting (or the global one).

The server has no per-API-key configuration (`apiKey` is a plain list of accepted keys), so per-key salts go through the `authorize` hook: map the key to a salt there and return it. A salt always replaces a `cache_salt` the body carries. An upstream whose driver is not `vllm` drops it and records `cache_salt` in `state.dropped` (or rejects it with `unsupported_field` under `unknownFields: "error"`); a vLLM upstream reached through its native `/v1/messages` (`nativeMessages`) does not get it either.

**`prompt_cache_key` (OpenAI).** OpenAI uses the key to route requests with a common prefix to the same cache. It is sent only to the `openai` driver: an OpenAI client's own `prompt_cache_key` is kept, an Anthropic client sets it as `metadata.prompt_cache_key`, and the upstream's `promptCacheKey` setting is the default for requests that carry none. Other drivers drop it and record `prompt_cache_key`. `prompt_cache_retention` is not mapped. No other provider's support for the field is claimed, because none of the driver documentation here cites it.

**Keeping prefixes stable.** A cache can only reuse a prefix that is byte-for-byte the same, so clients should keep what comes first constant:

- Put the system prompt, tool definitions and long reference documents first, in a fixed order, and the changing part (the user's latest turn, timestamps, request ids) last.
- Do not edit earlier turns of a conversation (rewriting history, reordering tools or changing their schemas invalidates everything after the change). Claude Code's tool search has the same effect: see [decision D-47](decisions.md).
- Keep per-request values out of the system prompt. The translator already removes the `x-anthropic-billing-header` block (`stripBillingHeader`), which changes on every request and would otherwise defeat prefix caching.
- Use one `cache_salt` per tenant, not per request: a per-request salt turns caching off.

## Endpoint pools: failover and load balancing

Upstreams that serve the same model (after aliases) form a pool for that model. The `pool` key of the translator config (also accepted in the CLI's JSON file) chooses how a request is spread over them:

```json
{
	"upstreams": [
		{ "name": "gpu1", "url": "http://gpu1:8000", "models": ["qwen3-coder"] },
		{ "name": "gpu2", "url": "http://gpu2:8000", "models": ["qwen3-coder"] }
	],
	"pool": {
		"strategy": "round_robin",
		"backoff": { "base": 1000, "max": 60000 },
		"connectTimeout": 10000,
		"headersTimeout": 0,
		"models": { "qwen3-coder": "least_busy" }
	}
}
```

| Key              | Default      | Meaning                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ---------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `strategy`       | `"failover"` | `failover`: configuration order, so the first endpoint is used until it fails. `round_robin`: rotate per model. `least_busy`: the endpoint with the fewest requests in flight, ties in configuration order.                                                                                                                                                                                                                                                                                                                                                               |
| `models`         | `{}`         | Strategy per model, keyed by the model name after aliases. Models not listed use `strategy`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `backoff.base`   | `1000`       | Milliseconds a failing endpoint is skipped after its first failure. Each further consecutive failure doubles it.                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `backoff.max`    | `60000`      | Upper limit of the backoff in milliseconds.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `connectTimeout` | `10000`      | Milliseconds to wait for the TCP connection of a request to an endpoint that has pool mates; `0` disables. A powered-off or unroutable host would otherwise hold each request for the operating system's connect timeout (about two minutes). Applied by the default transport, and for https it covers the TLS handshake too; a custom `transport` receives it as `init.connectTimeout` and may ignore it.                                                                                                                                                               |
| `healthInterval` | `10000`      | Milliseconds a readiness probe result is trusted before a request that has pool mates probes again; `0` turns probing off. Only drivers that name a health path are probed (vLLM: `GET /health`).                                                                                                                                                                                                                                                                                                                                                                         |
| `healthTimeout`  | `2000`       | Milliseconds a readiness probe may take before the endpoint counts as not ready.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `headersTimeout` | `0`          | Milliseconds to wait for the response headers of such a request; `0` (off) by default. A server that accepts the connection and never answers is only failed over from when this is set. It is off because vLLM sends the headers together with the first token, so a long prompt on a slow machine can legitimately take minutes; set it to the longest time to first token you accept. Nothing caps the reply once its headers have arrived, and it is not applied to the last endpoint left to try (nothing to fail over to, so a long prefill must not become a 502). |

With no `pool` key nothing changes: the first endpoint that serves the model is used, and requests only move on when it fails.

**When a request moves on.** A connection error or an HTTP 5xx from an endpoint, received before anything was sent to the client, sends the same request to the next endpoint of the pool. Each endpoint is tried at most once per request. Nothing else moves on: a 4xx (including 429) is the answer, a stream that fails after its first event is not replayed, and nothing is tried once the caller's abort signal has fired. The retry without images or tools ([decision D-38](decisions.md), `toolFallback`) happens on the endpoint that refused, before any failover, and the next endpoint starts with the full request. If every endpoint fails, the last endpoint's failure is the reply.

**Health.** An endpoint that failed is skipped by `request`, `send` and `route` until its backoff has passed; the next success resets it. Healthy endpoints are always tried before unhealthy ones, and when no endpoint of the pool is healthy they are all still tried, the one that recovers soonest first. A request takes its endpoint's in-flight slot when the endpoint is picked, so concurrent requests see each other, and keeps it until its reply is over (the JSON reply built, or the stream finished, failed or closed). A stream that is never read, or a library caller that never reads the reply or its `usage`, keeps the slot for good and makes that endpoint look busier to `least_busy` than it is: always consume or `return()` the stream. `request`, `route` and `token.count` take no slot and do not advance a round robin; only `send` does.

**Readiness.** An endpoint whose driver names a health path is asked whether it is ready before a request for a model with more than one endpoint is routed (vLLM: `GET /health`, which answers 200 while the engine is up and 503 once it is dead, and is not behind the API key). A 2xx is ready; a 5xx, a connection error or a timeout is not ready; any other answer (a proxy without that path) means the server cannot be asked, and it is not probed again until the next `detect()`. A not ready endpoint is treated like one that is backing off: the ready ones are tried first, and when nothing else serves the model it is still tried, so a stale answer can never make things worse. The verdict is trusted for `healthInterval`, so a busy pool costs one probe per endpoint per interval, not one per request; an endpoint that answered a request in that time is not probed, and a request that is answered marks the endpoint ready again. A lone endpoint is never probed on the request path. `api.health.check()` probes every upstream right away (a lone one included) and returns the pool status. `request` and `route` never probe; they use the last verdict. A change between ready and not ready is a `health` event.

**Timeouts.** `connectTimeout` and `headersTimeout` apply only to requests whose model has more than one endpoint in its pool; a single endpoint keeps the transport's no-timeout behaviour. A timeout counts as a connection error: the request moves on to the next endpoint and the endpoint is marked unhealthy.

**Seeing it.** `api.endpoint.status()` returns the pool config and one record per endpoint: `healthy` (false while backing off or not ready), `ready` (the last probe: `true`, `false`, or `null` when none ran), `readyReason`, `checkedAt`, `failures`, `retryAt`, `inflight`, `requests`, `errors`, `lastError`, `lastFailure`, `lastSuccess`. `api.status().upstreams[].health` carries the same record. The server has no route for it; serve it from your own handler (behind the same `apiKey` or `authorize` as everything else) if you want one.

**Usage and `authorize`.** The usage report's `upstream` (and `reply.usage`) names the endpoint that answered, or the last one tried when all failed. `authorize` runs once per HTTP request, before `send`, and failover never runs it again. `api.route(body)` returns `pool`, the endpoint names in the order they would be tried right now, and `upstream` is the first of them. It is a snapshot: it does not advance a round robin, and `send` decides again, so a different member can answer (use `usage.upstream` for the one that did).

## Forwarded requests and header allow-list

When the front and the upstream speak the same protocol the body is forwarded without conversion.

- **OpenAI front, OpenAI-protocol upstream.** The server keeps only known Chat Completions fields and the documented vLLM extensions (`top_k`, `min_p`, `repetition_penalty`, `chat_template_kwargs`, `thinking_token_budget`, `structured_outputs`, and similar), and reduces `stream_options` to the usage flags. Fields such as `kv_transfer_params`, `vllm_xargs`, `chat_template`, `cache_salt` and `priority` are dropped, so an untrusted client cannot reach server-side controls. Set the `passthroughFilter` setting to `false` to turn the filter off. Library calls (`api.request`) do not filter unless `passthroughFilter: true` is set or `filter: true` is passed.
- **Anthropic front, Anthropic upstream.** Only `anthropic-beta`, `anthropic-version` and `x-claude-code-*` request headers are forwarded; client authentication headers are never forwarded, the upstream key is used instead.

Redirects from an upstream are never followed. Unexpected errors reach the client as a generic `Internal server error` message; the details go to the Fastify logger when one is enabled.

## Several choices (`n`)

An OpenAI client that sends `n` above 1 to an Anthropic-protocol upstream (Anthropic has no `n`) gets the choices from `n` parallel upstream requests. An OpenAI-protocol upstream receives `n` unchanged and answers it itself, and nothing changes on the Anthropic front. The decision is made on the endpoint the router picks first; an `n` above 128 is answered with a 400.

Each branch is a full `send` of the same body with `n: 1`, so pools, failover, timeouts, retries and capture apply per branch, and each branch takes its own in-flight slot. Anthropic has no seed either, so the branches are `n` identical requests and the variety comes from sampling.

- **Not streaming.** The reply is the first branch's with every branch's choice, numbered 0 to n-1 in branch order, and the usage summed (`prompt_tokens`, `completion_tokens`, `total_tokens` and the detail fields).
- **Streaming.** Chunks go out as they arrive from any branch, each one re-indexed to its branch and carrying the id of the first chunk. The branches' own `[DONE]` sentinels are dropped. When the client asked for usage (`stream_options.include_usage`) there is one final usage chunk holding the sum, then a single `[DONE]`.
- **Failures.** The first branch to fail ends the request and the others are aborted. Before the stream has started that failure is the reply (an error reply, or a thrown error when the caller aborted). After it has started, the stream ends with the error chunk and `[DONE]`, the way a failed single stream does.
- **Cancelling.** The caller's `signal` aborts every branch, and `return()` on the stream (or the client disconnecting) cancels them too.
- **Usage.** `onUsage` and `reply.usage` carry one report: token fields and `estimated` are summed, `complete` is true only when every branch finished, `model` and `upstream` come from the first branch that knew them, and `reason` is the failing branch's when one failed.
- **Capture and events.** Each branch is its own exchange with its own attempt records, and its events (failover, fallbacks, warnings) are emitted as they happen. There is no event for the fan-out itself.

## Pings and early commit

Claude Code treats a silent stream as a dead connection, and a local model can stay silent for a long time while it processes a long prompt or thinks. vLLM only sends response headers together with the first token, so the translator handles the silence itself:

- While a streaming reply is flowing, a keep-alive is written whenever the upstream has been quiet for `pingInterval` ms (setting, default 10000, `0` disables; read from the upstream the request is routed to, so an upstream's `settings.pingInterval` overrides the global one). On the OpenAI front it is an SSE comment frame `: ping`. On the Anthropic front it is an empty delta (`text_delta`, `thinking_delta` or `input_json_delta` with no content) on the content block that is currently open, because Claude Code's idle watchdog ignores `event: ping` and aborts a stream after 300 seconds without a real event; `event: ping` is only used when no block is open.
- If the upstream has not answered the request at all after `pingInterval` ms (the same value as above, so it also comes from the routed upstream), the server commits to HTTP 200 with an SSE body. On the Anthropic front it immediately sends `message_start` (with the model the client asked for) and an empty thinking block, so the client sees activity at once, and the keep-alives ride on that block. When the upstream answers, the block is closed and the upstream's own blocks follow, shifted by one index (the first content block therefore has index 1). A later upstream error, such as a context overflow, is delivered in-band as `event: error` (Anthropic) or an error chunk followed by `[DONE]` (OpenAI).
- If the upstream answers within the interval, its real HTTP status is used, so retry logic and prompt-too-long handling keep working.

## Upstream timeouts

The default transport is built on `node:http` and applies no timeouts of its own: a slow upstream (for example a long prompt on a CPU) may take as long as it needs to send headers or the next token, and the request ends only when the upstream answers or the client disconnects. The global `fetch` is not used because it aborts after 300 seconds without response headers. A custom `transport` can still be supplied in the configuration.

## Client disconnects

When the client goes away the upstream request is aborted, so the GPU stops generating tokens nobody reads. This works while waiting for the upstream, while streaming, and after an early commit. A request whose client left before the route handler ran makes no upstream call and gets no `onUsage` call. Once an upstream call has been made, `onUsage` is called exactly once, also when the client left.

## Programmatic use

```js
import { createTranslator } from "@cldmv/llm-translator";

const api = await createTranslator({ upstreams: ["http://gpu-box:8000"] });
const server = await api.server.start({ host: "127.0.0.1", port: 8787, apiKey: "change-me" });
console.log(server.url); // http://127.0.0.1:8787

await server.close(); // one server
await api.server.stop(); // every server started through this translator; open connections are closed, not waited for
```

`start` options are `host`, `port`, `front`, `apiKey`, `bodyLimit` (default 64 MiB, large enough for images and PDFs), `logger`, `allowUnauthenticated`, `authorize`, `onUsage`, `metrics`, `tls`, `cors` and `rateLimit` (the last three are described in [TLS, rate limits and CORS](#tls-rate-limits-and-cors)). `front` applies to that server only, so one translator can serve an Anthropic port and an OpenAI port at the same time; `api.status().front` keeps reporting the configured front.

## Fastify plugin

```js
import Fastify from "fastify";
import { createTranslator } from "@cldmv/llm-translator";

const api = await createTranslator({ upstreams: ["http://gpu-box:8000"] });
const app = Fastify();
await app.register(api.server.plugin, { prefix: "/llm", apiKey: "change-me" });
await app.listen({ port: 3000 }); // POST /llm/v1/messages
```

The plugin is encapsulated: its error handler and auth hook apply only to its own routes. Options are `front`, `apiKey`, `bodyLimit`, `authorize`, `onUsage`, `metrics`, `cors` and `rateLimit`. TLS is not a plugin option: terminate it on the Fastify instance (`Fastify({ https })`).

## Your own server with the helper leaves

Any HTTP framework can use the pieces directly. `api.send(body, { signal, onUsage })` does the full round trip and returns either `{ status, headers, body }` or `{ status, headers, stream }`; `api.route(body)` resolves where a request would go without sending it; `api.sse` and `api.error` provide the wire helpers.

```js
import http from "node:http";
import { createTranslator } from "@cldmv/llm-translator";

const api = await createTranslator({ upstreams: ["http://gpu-box:8000"] });

http
	.createServer(async (req, res) => {
		const controller = new AbortController();
		res.on("close", () => res.writableFinished || controller.abort());

		const chunks = [];
		for await (const chunk of req) chunks.push(chunk);
		const reply = await api.send(JSON.parse(Buffer.concat(chunks)), { signal: controller.signal });

		if (reply.stream) {
			res.writeHead(reply.status, reply.headers);
			await api.sse.write(res, reply.stream); // frames plus keep-alive pings
			res.end();
		} else {
			res.writeHead(reply.status, reply.headers).end(JSON.stringify(reply.body));
		}
	})
	.listen(8787);
```

### Usage reporting and model allow-lists

Every reply from `send`, including error replies, has a `usage` property: a promise of one normalized report that never rejects. `onUsage(report)` receives the same report exactly once. For JSON and error replies the report is ready when `send` returns; for a stream it is delivered when the stream ends, fails or is stopped early (`break` or `return()`). A stream nobody iterates never settles. The stream is passed through unchanged, so `api.sse.write` works as before.

```js
const allowed = new Set(["qwen3-coder"]);

const body = JSON.parse(raw);
const { model, upstream } = api.route(body); // no I/O; throws TranslatorError (400) for a body that is not an object
if (!allowed.has(model)) return deny(403);

const reply = await api.send(body, {
	signal: controller.signal,
	onUsage: (report) => meter.add(apiKey, report) // or: reply.usage.then(...)
});
```

`api.route(body)` returns `{ upstream, model, requested, protocol, backend, native, unserved, pool }`: the upstream endpoint name, the model name sent upstream (after aliases and routing), the model the client asked for, the upstream protocol, its backend, whether the body is forwarded without conversion and whether no upstream lists the model. `pool` lists the endpoints that serve the model in the order they would be tried (see [Endpoint pools](#endpoint-pools-failover-and-load-balancing)).

The report:

| Field                                                                                     | Meaning                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `input_tokens`, `output_tokens`, `cache_read_input_tokens`, `cache_creation_input_tokens` | Numbers, or `null` when unknown (never `0` for unknown). `input_tokens` excludes cached tokens. A field the source did not carry stays `null`: for an upstream on the OpenAI protocol `cache_creation_input_tokens` is always `null` (cache creation is folded into `input_tokens`) and `cache_read_input_tokens` is `null` unless the upstream reported cached tokens. On the OpenAI front the numbers come from the OpenAI-shaped reply, so `cache_read_input_tokens` is `null` when no cached tokens were reported. |
| `reported`                                                                                | `false` when the reply carried no usage; every token field is then `null`.                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `estimated`                                                                               | `{ input_tokens, output_tokens }` for the sides the upstream did not report and the translator estimated in the client reply (see below), `null` for a side that was real; `null` altogether when nothing was estimated. Never mixed into the token fields.                                                                                                                                                                                                                                                            |
| `complete`                                                                                | `true` only when the reply finished normally. A stream counts as finished only once its terminal marker was seen: `message_stop` (Anthropic front), the `[DONE]` sentinel (OpenAI front; every stream the translator produces ends with it when it finishes normally, so an upstream that closes without it counts as truncated). A stream that ends without it is reported with reason `error`.                                                                                                                       |
| `reason`                                                                                  | `"done"`, `"aborted"` (signal aborted, or the consumer stopped iterating), `"error"` (stream failure, connection failure, conversion failure) or `"upstream_error"` (non-OK upstream status).                                                                                                                                                                                                                                                                                                                          |
| `model`, `requested`, `upstream`, `front`, `stream`                                       | Model sent upstream, model the client asked for, upstream endpoint name, client protocol, and whether a stream was requested.                                                                                                                                                                                                                                                                                                                                                                                          |

When a converted reply's upstream did not report a side of the usage (input or output: the field is absent, so a reported 0 stays 0; a usage object with every field absent or zero counts as nothing reported, like the `reported` flag), the client-protocol reply carries an estimate for that side instead of zero, and a side the upstream did report is left alone. The input estimate is the server tokenizer's count when the driver has one (vLLM `/tokenize`, Anthropic `count_tokens`; skipped for an OpenAI-front stream whose client did not ask for usage, so the end of the stream is not delayed), else one token per four characters of the upstream request (the estimate `token.count` uses). The output estimate is one token per four characters of generated text, reasoning and tool arguments (at least 1). On the Anthropic front a stream carries them in the final `message_delta` (`message_start` is sent before the output is known and still shows 0 input tokens); on the OpenAI front they go in the final usage chunk, with `total_tokens` the sum of the two sides. The report itself never presents them as counts: its token fields keep only what the upstream reported, and `estimated` holds `{ input_tokens, output_tokens }` with `null` for a side that was real (and is `null` altogether when nothing was estimated), so a metering caller can choose to use or ignore them. Replies passed through without conversion are not altered and have `estimated: null`.

`api.embeddings.send` reports the same way: each reply has the `usage` promise and `onUsage` is called once, with the `authorize` context on the server route. The report has `front: "openai"` and `stream: false`; `input_tokens` is the reply's `prompt_tokens` (`total_tokens` is not reported) and the other token fields are `null`. A reply without `usage` reports `reported: false`. Like chat, error replies are reported too: `reason` is `"upstream_error"` when the upstream answered with an error, `"aborted"` for an abort (the 499 reply) and `"error"` for an invalid body, an unknown model, an unreachable upstream or a body that is not JSON, with `model` and `upstream` `null` until an endpoint was tried.

A partial stream reports the usage seen so far (cumulative; the last values win). Counts are read from the client-protocol output, except for an Anthropic-front reply converted from an OpenAI-protocol upstream, where the upstream's own `usage` is used. On the OpenAI front the translator always asks the upstream for the final usage chunk of a stream, so the report is complete whatever the client sent; the client receives that chunk only when it sent `stream_options.include_usage`. With the `streamUsage` setting off (for upstreams that reject `stream_options`) the translator does not add the option to a pass-through request, so such streams report `reported: false` unless the client asked for usage itself. Usage that is absent or all zero counts as not reported. An exception in `onUsage` is reported as a warning and never breaks the reply. When `send` throws (the caller aborted), `onUsage` is still called.

- `api.sse.encode(event)` formats one frame, `api.sse.parse(source)` reads frames, `api.sse.ping(events, { interval })` adds pings to any event stream, and `api.sse.write(target, events)` pumps a stream into a writable with backpressure.
- `api.error.build(status, message, { type, code, param })` creates an error reply in the front's shape for failures that originate in your server, such as authentication.
