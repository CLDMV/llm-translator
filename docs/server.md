# Server and CLI

The translator can run as a standalone HTTP server, as a Fastify plugin inside an existing app, or be wired into any other server using the helper leaves. Fastify is an optional peer dependency: install it (`npm install fastify`) to use `server.start` or `server.plugin`.

## Fronts and routes

The server speaks one client protocol, the front, chosen with `front` (default `anthropic`).

| Front       | Routes                                                                                                            |
| ----------- | ----------------------------------------------------------------------------------------------------------------- |
| `anthropic` | `POST /v1/messages`, `POST /v1/messages/count_tokens`, `GET /v1/models`, `GET` and `HEAD` on `/` and `/api/hello` |
| `openai`    | `POST /v1/chat/completions`, `GET /v1/models`, `GET` and `HEAD` on `/`                                            |

Streaming replies use `content-type: text/event-stream`. Errors are always returned in the front's own error shape.

## CLI

```bash
llm-translator --front anthropic --upstream http://gpu-box:8000 --port 8787
```

| Flag                                | Environment variable                        | Meaning                                           |
| ----------------------------------- | ------------------------------------------- | ------------------------------------------------- |
| `--front`                           | `LLM_TRANSLATOR_FRONT`                      | `anthropic` (default) or `openai`                 |
| `--upstream <url>` (repeatable)     | `LLM_TRANSLATOR_UPSTREAM` (comma separated) | upstream base URL                                 |
| `--upstream-key`                    | `LLM_TRANSLATOR_UPSTREAM_KEY`               | key sent to the upstream                          |
| `--backend`                         | `LLM_TRANSLATOR_BACKEND`                    | driver name instead of auto-detection             |
| `--model alias=target` (repeatable) |                                             | model alias                                       |
| `--host`                            | `LLM_TRANSLATOR_HOST`                       | listen address, default `127.0.0.1`               |
| `--port`                            | `LLM_TRANSLATOR_PORT`                       | listen port, default `8787`                       |
| `--api-key`                         | `LLM_TRANSLATOR_API_KEY`                    | key clients must send                             |
| `--config <file>`                   | `LLM_TRANSLATOR_CONFIG`                     | JSON config file                                  |
| `--allow-unauthenticated`           | `LLM_TRANSLATOR_ALLOW_UNAUTHENTICATED=1`    | allow a non-loopback `--host` without `--api-key` |
| `--silent`, `--no-detect`           |                                             | suppress warnings, skip detection                 |

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

## Authentication

Listening on anything other than a loopback address (`127.x`, `::1`, `localhost`) requires an `apiKey`: the start-up is refused otherwise, because anyone who can reach the port could spend your GPU. Pass `--allow-unauthenticated` (`allowUnauthenticated: true`) to opt out, for example behind a trusted network or an authenticating reverse proxy.

`apiKey` (a string or an array) makes the server require the key as `x-api-key` or `Authorization: Bearer <key>` on the API routes. `/` and `/api/hello` stay open. Upstream keys are configured separately on each upstream and never reach the client.

## Forwarded requests and header allow-list

When the front and the upstream speak the same protocol the body is forwarded without conversion.

- **OpenAI front, OpenAI-protocol upstream.** The server keeps only known Chat Completions fields and the documented vLLM extensions (`top_k`, `min_p`, `repetition_penalty`, `chat_template_kwargs`, `thinking_token_budget`, `structured_outputs`, and similar), and reduces `stream_options` to the usage flags. Fields such as `kv_transfer_params`, `vllm_xargs`, `chat_template`, `cache_salt` and `priority` are dropped, so an untrusted client cannot reach server-side controls. Set the `passthroughFilter` setting to `false` to turn the filter off. Library calls (`api.request`) do not filter unless `passthroughFilter: true` is set or `filter: true` is passed.
- **Anthropic front, Anthropic upstream.** Only `anthropic-beta`, `anthropic-version` and `x-claude-code-*` request headers are forwarded; client authentication headers are never forwarded, the upstream key is used instead.

Redirects from an upstream are never followed. Unexpected errors reach the client as a generic `Internal server error` message; the details go to the Fastify logger when one is enabled.

## Pings and early commit

Claude Code treats a silent stream as a dead connection, and a local model can stay silent for a long time while it processes a long prompt or thinks. vLLM only sends response headers together with the first token, so the translator handles the silence itself:

- While a streaming reply is flowing, an `event: ping` (Anthropic front) or an SSE comment frame `: ping` (OpenAI front) is written whenever the upstream has been quiet for `pingInterval` ms (setting, default 10000, `0` disables).
- If the upstream has not answered the request at all after `pingInterval` ms, the server commits to HTTP 200 with an SSE body and starts pinging. A later upstream error, such as a context overflow, is then delivered in-band as `event: error` (Anthropic) or an error chunk followed by `[DONE]` (OpenAI).
- If the upstream answers within the interval, its real HTTP status is used, so retry logic and prompt-too-long handling keep working.

## Upstream timeouts

The default transport is built on `node:http` and applies no timeouts of its own: a slow upstream (for example a long prompt on a CPU) may take as long as it needs to send headers or the next token, and the request ends only when the upstream answers or the client disconnects. The global `fetch` is not used because it aborts after 300 seconds without response headers. A custom `transport` can still be supplied in the configuration.

## Client disconnects

When the client goes away the upstream request is aborted, so the GPU stops generating tokens nobody reads. This works while waiting for the upstream, while streaming, and after an early commit.

## Programmatic use

```js
import { createTranslator } from "@cldmv/llm-translator";

const api = await createTranslator({ upstreams: ["http://gpu-box:8000"] });
const server = await api.server.start({ host: "127.0.0.1", port: 8787, apiKey: "change-me" });
console.log(server.url); // http://127.0.0.1:8787

await server.close(); // one server
await api.server.stop(); // every server started through this translator; open connections are closed, not waited for
```

`start` options are `host`, `port`, `front`, `apiKey`, `bodyLimit` (default 64 MiB, large enough for images and PDFs), `logger` and `allowUnauthenticated`. `front` applies to that server only, so one translator can serve an Anthropic port and an OpenAI port at the same time; `api.status().front` keeps reporting the configured front.

## Fastify plugin

```js
import Fastify from "fastify";
import { createTranslator } from "@cldmv/llm-translator";

const api = await createTranslator({ upstreams: ["http://gpu-box:8000"] });
const app = Fastify();
await app.register(api.server.plugin, { prefix: "/llm", apiKey: "change-me" });
await app.listen({ port: 3000 }); // POST /llm/v1/messages
```

The plugin is encapsulated: its error handler and auth hook apply only to its own routes. Options are `front`, `apiKey` and `bodyLimit`.

## Your own server with the helper leaves

Any HTTP framework can use the pieces directly. `api.send(body, { signal })` does the full round trip and returns either `{ status, headers, body }` or `{ status, headers, stream }`; `api.sse` and `api.error` provide the wire helpers.

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

- `api.sse.encode(event)` formats one frame, `api.sse.parse(source)` reads frames, `api.sse.ping(events, { interval })` adds pings to any event stream, and `api.sse.write(target, events)` pumps a stream into a writable with backpressure.
- `api.error.build(status, message, { type, code, param })` creates an error reply in the front's shape for failures that originate in your server, such as authentication.
