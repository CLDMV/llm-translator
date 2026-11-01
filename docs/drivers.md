# Drivers, detection and routing

A driver teaches the translator how one kind of upstream server behaves: which protocol it speaks, how to recognize it, which converter settings suit it, and any small normalizations it needs. Consumer code never names a backend; each upstream is bound to a driver once at startup.

## Architecture

Drivers are slothlet leaves under `api/driver/<name>/`, mounted at `api.driver.<name>`. The built-in set:

| Driver       | Protocol             | Order | Matches                                                                                     |
| ------------ | -------------------- | ----- | ------------------------------------------------------------------------------------------- |
| `vllm`       | `openai.chat`        | 10    | `GET /version` returns a version, or `GET /v1/models` lists a model with `owned_by: "vllm"` |
| `anthropic`  | `anthropic.messages` | 20    | host `api.anthropic.com` (no network access)                                                |
| `openai`     | `openai.chat`        | 30    | host `api.openai.com` (no network access)                                                   |
| `deepseek`   | `openai.chat`        | 35    | host `api.deepseek.com` (no request of its own)                                             |
| `llamacpp`   | `openai.chat`        | 40    | `GET /props` has llama-server fields, or `GET /v1/models` lists `owned_by: "llamacpp"`      |
| `sglang`     | `openai.chat`        | 50    | `GET /get_server_info` has `model_path`, or `GET /v1/models` lists `owned_by: "sglang"`     |
| `ollama`     | `openai.chat`        | 60    | `GET /api/version` returns a version                                                        |
| `compatible` | `openai.chat`        | 100   | always; the fallback for LM Studio and other servers without a driver                       |

A driver folder contains these files, all optional except `info`:

- `info.mjs`: `info() → { name, protocol, order, auth, headers?, probes?, paths }`. `auth` is `"bearer"` or `"x-api-key"`, `headers` are sent on every request (the Anthropic driver adds `anthropic-version`), `paths` names the chat or messages path, and `probes` lists the GET paths `detect` will ask for (see Detection).
- `detect.mjs`: `detect({ endpoint, transport, signal, timeout, probes }) → facts | null`. Return `null` for "not this backend". A thrown error counts as no match. Ask for paths with `http.probe(context, path)` (from `lib/http.mjs`) so a path another driver already fetched is not fetched again.
- `settings.mjs`: `settings(facts) → partial settings`.
- `probe.mjs`: `probe({ endpoint, transport, facts, ... }) → partial settings`, for checks that need a request (vLLM uses it for inline system messages).
- `request.mjs`, `response.mjs`, `chunk.mjs`, `error.mjs`: normalizers in the upstream protocol. `request(body, ctx)` and `response(body, ctx)` get the converted body, `chunk(chunk, ctx)` gets each parsed streaming chunk, `error(status, body, ctx)` gets an error body before it is rendered for the client.
- `token/count.mjs` and `model/list.mjs`: exact token counting and a live model listing.

## Detection

`createTranslator` binds every upstream during creation. Upstreams with `backend: "auto"` (the default) are probed with the drivers in `info().order`; the first driver whose `detect` returns facts wins. The generic `compatible` driver always matches, so detection cannot fail outright. If the server did not answer at all, `compatible` is bound with `facts.reachable === false` and one warning is printed (unless `silent`).

- Servers that no earlier driver claims (a generic OpenAI-compatible server on any host that is not a hosted API) are sent the later drivers' probes at startup: `GET /props`, `/get_server_info` and `/api/version`, with the upstream's bearer key like every other probe, in parallel and bounded by `detectTimeout`. Set `backend` to skip them.
- Detection costs the slowest probe, not their sum. Host-name drivers need no network. At the first driver that declares `probes`, the paths of every remaining driver are requested in parallel, and each path is requested once per upstream and shared (`GET /v1/models` is fetched once for vLLM, llama.cpp and the generic driver). A server that matches an earlier driver, vLLM first, is never asked for the later drivers' paths.
- Set `backend: "vllm"` (or any driver name) on an upstream to skip detection and all probing for it. `version` can be supplied so version-mapped settings still apply.
- Set `detect: false` on the translator to skip every request. Auto upstreams are then bound to `compatible`.
- `await api.detect()` re-probes at any time and returns the same report as `api.status()`.

### What each probe does

- vLLM: `GET /version` and `GET /v1/models` in parallel. Facts are `{ version, models, maxModelLen }`. After binding, when the resolved `inlineSystem` is still `auto`, `POST /tokenize` is called with `[system, user, system, user]`; success means the chat template tolerates inline system messages (`keep`), failure means they are folded into the neighbouring user turn (`user`). Unless `images` is configured, a one-token chat completion with a 1x1 image is also sent: a `400` saying the model is not multimodal sets `images: false` (so images and PDF page images become text notes instead of failing every request), success keeps `images: true`, and any other answer (including a timeout) leaves the default. Settings you configure yourself are never probed.
- llama.cpp: `GET /props` (fields `default_generation_settings`, `total_slots` or `build_info`) and `GET /v1/models` (`owned_by: "llamacpp"`). Facts are `{ models, build, vision }`; `vision` comes from `modalities.vision` in newer builds and sets `images`.
- SGLang: `GET /get_server_info` and `GET /v1/models` (`owned_by: "sglang"`). Facts are `{ version, models, modelPath, reasoningParser, toolCallParser }`. SGLang also answers `/version`, so vLLM detection steps aside when `/v1/models` names `sglang` or `llamacpp`, and, when a server answers `/version` without naming itself vLLM (for example because its model list failed), when `/get_server_info` or `/props` identify SGLang or llama.cpp. A real vLLM server names itself in `/v1/models` and is never asked for those paths.
- Ollama: `GET /api/version` (and the shared `GET /v1/models` for the model list). Facts are `{ version, models }`.
- OpenAI, DeepSeek and Anthropic: a host-name check, no request of their own. (vLLM is tried first and probes any host; a hosted API answers it with a 404 or an error.)
- Generic: `GET /v1/models` for reachability and the served model ids.

### Text-only models behind any OpenAI-protocol driver

Only the vLLM driver probes image support at startup. For every other OpenAI-protocol upstream the `imageFallback` setting (default on) covers the same case lazily: when a request that carried images is answered with HTTP 400 and a message that says the model does not accept images, the translator retries once without them and remembers `images: false` for that upstream and model until the process ends. Recognised wordings include vLLM `... is not a multimodal model` and `At most 0 image(s) may be provided`, `image_url is only supported by certain models`, `Model does not support images` and llama.cpp's `image input is not supported`. Any other 400 (a bad data URL, an oversized image) is returned unchanged. Streaming and non-streaming requests behave the same, in `send` and in the server. See [decision D-38](decisions.md).

### vLLM started without tool parsing

A vLLM server started without `--enable-auto-tool-choice` and `--tool-call-parser <parser>` answers every request that carries tools with HTTP 400, `"auto" tool choice requires --enable-auto-tool-choice and --tool-call-parser to be set`. The translator recognises the message by those flag names and appends a hint to the error the client receives (in the Anthropic or OpenAI error shape): the server needs the two flags, and the parser depends on the model family. Set `toolFallback: true` to retry such a request once without tools instead; the retry applies to OpenAI-protocol upstreams, streaming and non-streaming alike, and is not remembered between requests. See [decision D-39](decisions.md).

## llama.cpp (`llama-server`)

What the `llamacpp` driver changes compared with the generic one:

- `reasoningField: "reasoning_content"`, `maxTokensField: "max_tokens"`, `topK: true`, `prefill: "none"`, `thinking: "chat_template_kwargs"` (thinking toggles need `--jinja`), and `images` from `/props` when the build reports `modalities.vision`.
- Requests with tools get `parallel_tool_calls: true` (llama-server leaves parallel calls off unless asked; the converter only ever sends `false`) unless the client disabled them or `parallelToolCalls` is off. vLLM's `repetition_penalty` is renamed `repeat_penalty`.
- Tool calls without an `id`, streamed or not, get a generated `call_...` id. The Anthropic front already invented ids for them; the OpenAI front now receives them too.
- Reasoning formats: `--reasoning-format deepseek` returns `reasoning_content` and `none` leaves `<think>` tags in `content`, both read as before. `deepseek-legacy` does both, so a leading `<think>...</think>` is cut from `content` when `reasoning_content` already carries it.
- Tools need `--jinja`. A `400` that names `--jinja` is recognised like vLLM's missing tool parser: the client error gets a hint, and `toolFallback` retries without tools. See [decision D-41](decisions.md).

llama-server also serves `/v1/messages` natively; the driver does not use it (separate issue, [#31](https://github.com/CLDMV/llm-translator/issues/31)). Nothing here has been run against a real `llama-server` yet: the detection fields, the `deepseek-legacy` shape and the refusal wordings come from the llama.cpp documentation and sources (tracked in [#70](https://github.com/CLDMV/llm-translator/issues/70)).

## DeepSeek API

What the `deepseek` driver changes compared with the generic one:

- `reasoningField: "reasoning_content"`, `maxTokensField: "max_tokens"`, `topK: false`, `prefill: "none"`, `responseFormat: false` (the API takes `json_object` only, not `json_schema`), `images: false` (text-only models), and no thinking switch: thinking follows the model (`deepseek-reasoner`).
- In thinking mode (a `reasoner` model, or a body that enables `thinking`) a forced `tool_choice` (`required` or a named function) and `logprobs`/`top_logprobs` are removed and recorded in `state.dropped`; `auto` and `none` stay.
- Usage that arrives on the last content chunk (rather than a separate `choices: []` chunk) is read like any other usage, for both fronts and the usage report.
- With tools, DeepSeek requires the `reasoning_content` of earlier turns to be sent back. The translator already sends thinking blocks that the client replays as `reasoning_content`, so a conversation whose history still carries its thinking blocks works. When the history lacks them (the client did not replay them, or `clear_thinking` removed them) DeepSeek answers 400, and the driver appends an explanation to that error. Keeping the reasoning on the translator's side so such conversations work is not part of this driver: it is the reasoning side channel, tracked in [#45](https://github.com/CLDMV/llm-translator/issues/45).

Nothing here has been run against the real API: the `/v1` paths, the model names that mean thinking mode and the error wording are from the DeepSeek documentation (tracked in [#70](https://github.com/CLDMV/llm-translator/issues/70)). See [decision D-44](decisions.md).

## SGLang

What the `sglang` driver changes compared with the generic one:

- `reasoningField: "reasoning_content"`, `maxTokensField: "max_completion_tokens"`, `topK: true`, `prefill: "none"`, `thinking: "chat_template_kwargs"`.
- When `/get_server_info` shows the server runs with a `--reasoning-parser`, requests carry `separate_reasoning: true` (unless the client set it), so the model's thinking arrives in `reasoning_content` and becomes `thinking` blocks. Without a parser the reasoning stays inline in `content` and `thinkTags` reads a leading `<think>` block as before (use `thinkOpen` for templates that open the tag in the prompt).
- Streams that carry `reasoning_content` deltas, text and tool calls convert to `thinking`, `text` and `tool_use` blocks like any other OpenAI-protocol upstream.
- SGLang's `regex`, `ebnf` and `separate_reasoning` fields pass the OpenAI front's `passthroughFilter` for SGLang upstreams only (a driver lists its own fields in `info().fields`), so an OpenAI client can send them to SGLang and they are stripped for every other backend, api.openai.com included. llama.cpp does the same for `repeat_penalty` and `grammar`. (vLLM's documented extensions remain allowed for every backend, as before.) Forced tool choice (`required` or a named function) is handled by the server (it builds an EBNF grammar itself); the driver passes `tool_choice` through.

Nothing here has been run against a real SGLang server yet: the detection fields, `owned_by: "sglang"` and the image refusal wording are unverified (tracked in [#70](https://github.com/CLDMV/llm-translator/issues/70)). See [decision D-43](decisions.md).

## Ollama (`/v1`)

What the `ollama` driver changes compared with the generic one:

- `tool_choice`, `n` and `logit_bias` are removed (Ollama's `/v1` does not implement them) and recorded in `state.dropped`. `top_k` and `parallel_tool_calls` are not sent, and `max_tokens` is the output cap field.
- Images given by URL are replaced by a short text note and recorded as a drop (`image_url`): `/v1` takes base64 data URLs only, and the translator does not fetch URLs on a client's behalf (the same rule as for documents by URL). Base64 images, which is what Claude Code sends, pass through.
- Ollama truncates prompts that exceed `num_ctx` without any error, and the default is small. The driver sets `contextWindow: 4096` and prints one warning per upstream the first time a request is estimated (four characters per token) to exceed it. Raise the real limit on the server (`OLLAMA_CONTEXT_LENGTH` or a Modelfile `num_ctx`) and set the upstream's `contextWindow` to match; `0` turns the warning off. See [decision D-42](decisions.md).

Nothing here has been run against a real Ollama server yet; in particular the wording Ollama uses to refuse images on a text-only model is not in the `imageFallback` list (tracked in [#70](https://github.com/CLDMV/llm-translator/issues/70)).

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
