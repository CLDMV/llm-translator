# Drivers, detection and routing

A driver teaches the translator how one kind of upstream server behaves: which protocol it speaks, how to recognize it, which converter settings suit it, and any small normalizations it needs. Consumer code never names a backend; each upstream is bound to a driver once at startup.

## Architecture

Drivers are slothlet leaves under `api/driver/<name>/`, mounted at `api.driver.<name>`. The built-in set:

| Driver       | Protocol             | Order | Matches                                                                                     |
| ------------ | -------------------- | ----- | ------------------------------------------------------------------------------------------- |
| `vllm`       | `openai.chat`        | 10    | `GET /version` returns a version, or `GET /v1/models` lists a model with `owned_by: "vllm"` |
| `anthropic`  | `anthropic.messages` | 20    | host `api.anthropic.com` (no network access)                                                |
| `openai`     | `openai.chat`        | 30    | host `api.openai.com` (no network access)                                                   |
| `compatible` | `openai.chat`        | 100   | always; the fallback for llama.cpp, SGLang, Ollama, LM Studio and similar servers           |

A driver folder contains these files, all optional except `info`:

- `info.mjs`: `info() → { name, protocol, order, auth, headers?, paths }`. `auth` is `"bearer"` or `"x-api-key"`, `headers` are sent on every request (the Anthropic driver adds `anthropic-version`), `paths` names the chat or messages path.
- `detect.mjs`: `detect({ endpoint, transport, signal, timeout }) → facts | null`. Return `null` for "not this backend". A thrown error counts as no match.
- `settings.mjs`: `settings(facts) → partial settings`.
- `probe.mjs`: `probe({ endpoint, transport, facts, ... }) → partial settings`, for checks that need a request (vLLM uses it for inline system messages).
- `request.mjs`, `response.mjs`, `chunk.mjs`, `error.mjs`: normalizers in the upstream protocol. `request(body, ctx)` and `response(body, ctx)` get the converted body, `chunk(chunk, ctx)` gets each parsed streaming chunk, `error(status, body, ctx)` gets an error body before it is rendered for the client.
- `token/count.mjs` and `model/list.mjs`: exact token counting and a live model listing.

## Detection

`createTranslator` binds every upstream during creation. Upstreams with `backend: "auto"` (the default) are probed with the drivers in `info().order`; the first driver whose `detect` returns facts wins. The generic `compatible` driver always matches, so detection cannot fail outright. If the server did not answer at all, `compatible` is bound with `facts.reachable === false` and one warning is printed (unless `silent`).

- Set `backend: "vllm"` (or any driver name) on an upstream to skip detection and all probing for it. `version` can be supplied so version-mapped settings still apply.
- Set `detect: false` on the translator to skip every request. Auto upstreams are then bound to `compatible`.
- `await api.detect()` re-probes at any time and returns the same report as `api.status()`.

### What each probe does

- vLLM: `GET /version` and `GET /v1/models` in parallel. Facts are `{ version, models, maxModelLen }`. After binding, when the resolved `inlineSystem` is still `auto`, `POST /tokenize` is called with `[system, user, system, user]`; success means the chat template tolerates inline system messages (`keep`), failure means they are folded into the neighbouring user turn (`user`). Unless `images` is configured, a one-token chat completion with a 1x1 image is also sent: a `400` saying the model is not multimodal sets `images: false` (so images and PDF page images become text notes instead of failing every request), success keeps `images: true`, and any other answer (including a timeout) leaves the default. Settings you configure yourself are never probed.
- OpenAI and Anthropic: a host-name check, no network.
- Generic: `GET /v1/models` for reachability and the served model ids.

### Text-only models behind any OpenAI-protocol driver

Only the vLLM driver probes image support at startup. For every other OpenAI-protocol upstream the `imageFallback` setting (default on) covers the same case lazily: when a request that carried images is answered with HTTP 400 and a message that says the model does not accept images, the translator retries once without them and remembers `images: false` for that upstream and model until the process ends. Recognised wordings include vLLM `... is not a multimodal model` and `At most 0 image(s) may be provided`, `image_url is only supported by certain models`, `Model does not support images` and llama.cpp's `image input is not supported`. Any other 400 (a bad data URL, an oversized image) is returned unchanged. Streaming and non-streaming requests behave the same, in `send` and in the server. See [decision D-38](decisions.md).

## Version-mapped settings for vLLM

The vLLM driver turns the detected version into settings. An unknown or missing version is treated as the newest release, with one exception: `thinkingBudget` is only enabled for a version that is known to be 0.19.0 or later, because sending `thinking_token_budget` to a server that does not know it is worse than not bounding the thinking.

| Setting          | Value                                                                                                                                                  | Boundary                                                    |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------- |
| `reasoningField` | `reasoning_content`                                                                                                                                    | below 0.16.0                                                |
| `reasoningField` | `reasoning`                                                                                                                                            | 0.16.0 and later                                            |
| `thinkingBudget` | `true`                                                                                                                                                 | 0.19.0 and later (`thinking_token_budget`)                  |
| `effort`         | `true`                                                                                                                                                 | 0.22.0 and later (`reasoning_effort` also toggles thinking) |
| always           | `maxTokensField: "max_completion_tokens"`, `streamUsage`, `continuousUsage` (vLLM only), `prefill: "continue_final_message"`, `topK`, `responseFormat` | all versions                                                |

`reasoning_effort` is clamped to `low`, `medium` or `high` (`xhigh` and `max` become `high`) because vLLM rejects other values; set `effortPassthrough: true` in the upstream's settings to send the client's value unchanged.

Reading is never version dependent: the converters accept `reasoning`, `reasoning_content` and `<think>` tags in content.

## Precedence

For every setting the winner is, from highest to lowest: the upstream's own `settings`, the translator's global `settings`, probed values, driver settings, library defaults. The `inlineSystem` probe only runs when nothing above it set the value.

## Routing

`request(body)` picks the upstream for `body.model`:

1. The alias map (`aliases: { "claude-haiku-5-5": "qwen3-coder" }`) rewrites the model name sent upstream. The client still sees the name it asked for in responses.
2. The first upstream that serves the (rewritten) model. Served models come from the upstream's `models` list or from detection (`/v1/models`). An Anthropic-protocol upstream without a `models` list serves every `claude-*` id.
3. The upstream marked `default: true`, otherwise the first one. When nothing serves the requested model and that fallback upstream knows exactly one model, that model is sent instead (the client still sees the name it asked for). With several or no known models the name is sent unchanged, and a `404` from the upstream is extended with a hint naming the model and pointing at `aliases`.

Upstream URLs may end in `/v1`; the suffix is removed because the driver paths already include it.

When the client protocol equals the upstream protocol (Anthropic front with an Anthropic upstream, or OpenAI front with an OpenAI-protocol upstream) the body is forwarded natively: only the driver normalizers run and the model name is restored on the way back.

## Writing a third-party driver

A driver is a folder of leaves. Given this tree:

```text
my-drivers/acme/
├── info.mjs
├── detect.mjs
├── settings.mjs
└── request.mjs
```

```js
// info.mjs
export function info() {
	return { name: "acme", protocol: "openai.chat", order: 15, auth: "bearer", paths: { chat: "/api/chat" } };
}

// detect.mjs
export async function detect({ endpoint, transport, signal, timeout }) {
	// `transport` is a fetch-compatible function.
	const res = await transport(`${endpoint.url}/acme/health`, { signal });
	return res.ok ? { acme: true } : null;
}

// settings.mjs
export function settings() {
	return { topK: false, prefill: "none" };
}

// request.mjs
export function request(body) {
	return { ...body, acme_extension: true };
}
```

Mount it before the translator probes, or mount it and re-detect:

```js
import { createTranslator } from "@cldmv/llm-translator";

const api = await createTranslator({ upstreams: ["http://acme-box:9000"], detect: false });
await api.slothlet.api.add(["driver", "acme"], "/abs/path/to/my-drivers/acme");
console.log(Object.keys(api.driver)); // [ "acme", "anthropic", "compatible", "openai", "vllm" ]

const status = await api.detect();
console.log(status.upstreams[0].driver); // "acme"
```

Detection iterates `api.driver` by `info().order`, so a lower order than `compatible` (100) is enough for the new driver to be tried first. An upstream can also select it explicitly with `backend: "acme"`.
