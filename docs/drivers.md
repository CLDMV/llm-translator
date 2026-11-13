# Drivers, detection and routing

A driver teaches the translator how one kind of upstream server behaves: which protocol it speaks, how to recognize it, which converter settings suit it, and any small normalizations it needs. Consumer code never names a backend; each upstream is bound to a driver once at startup.

## Architecture

Drivers are slothlet leaves under `api/driver/<name>/`, mounted at `api.driver.<name>`. The built-in set:

| Driver       | Protocol             | Order | Matches                                                                                                         |
| ------------ | -------------------- | ----- | --------------------------------------------------------------------------------------------------------------- |
| `vllm`       | `openai.chat`        | 10    | `GET /version` returns a version, or `GET /v1/models` lists a model with `owned_by: "vllm"`                     |
| `openai`     | `openai.chat`        | 30    | host `api.openai.com` (no network access)                                                                       |
| `deepseek`   | `openai.chat`        | 35    | host `api.deepseek.com` (no request of its own)                                                                 |
| `azure`      | `openai.chat`        | 32    | host `*.openai.azure.com`, `*.cognitiveservices.azure.com` or `*.services.ai.azure.com` (no request of its own) |
| `mistral`    | `openai.chat`        | 36    | host `api.mistral.ai` (no request of its own)                                                                   |
| `openrouter` | `openai.chat`        | 37    | host `openrouter.ai` (no request of its own)                                                                    |
| `anthropic`  | `anthropic.messages` | 38    | host `api.anthropic.com` (no request), or `GET /v1/models` answers with an Anthropic model list                 |
| `llamacpp`   | `openai.chat`        | 40    | `GET /props` has llama-server fields, or `GET /v1/models` lists `owned_by: "llamacpp"`                          |
| `tgi`        | `openai.chat`        | 45    | `GET /info` is Text Generation Inference's router description (strict shape check)                              |
| `localai`    | `openai.chat`        | 52    | `GET /version` is `<version> (<commit>)`, or `GET /.well-known/localai.json` is LocalAI's discovery document    |
| `sglang`     | `openai.chat`        | 50    | `GET /get_server_info` has `model_path`, or `GET /v1/models` lists `owned_by: "sglang"`                         |
| `lmstudio`   | `openai.chat`        | 55    | `GET /api/v0/models` is LM Studio's model listing (strict shape check)                                          |
| `ollama`     | `openai.chat`        | 60    | `GET /api/version` returns a version                                                                            |
| `compatible` | `openai.chat`        | 100   | always; the fallback for servers without a driver                                                               |

A driver folder contains these files, all optional except `info`:

- `info.mjs`: `info() → { name, protocol, order, auth, strict?, hosts?, headers?, probes?, fields?, toolCallIds?, paths }`. `strict` says whether the backend enforces `strict` tool use (`true` for `anthropic`, `openai` and `vllm`, which enforces it when started with strict tool calling, `--tool-strict-level`; `false` or absent for the others): a request with a strict tool sent to a driver without it gets a `strict` warning that the tool is not enforced. `auth` is `"bearer"`, `"x-api-key"` or `"api-key"` (Azure OpenAI), `headers` are sent on every request (the Anthropic driver adds `anthropic-version`), `paths` names the chat or messages path (and optionally `embeddings` and `models`, which default to `/v1/embeddings` and `/v1/models`), `probes` lists the GET paths `detect` will ask for (see Detection), `hosts` lists host names the driver matches without a request (a driver that lists `probes` and matches the upstream's host does not start the batched probes; the Anthropic driver lists `api.anthropic.com`), and `fields` lists the extra request fields the OpenAI front's `passthroughFilter` lets through to this backend. `fields` must be an array of strings (or absent); `detect` rejects anything else with `invalid_driver`. `toolCallIds` (optional) describes a backend with a strict tool-call id format: `{ alphabet, min?, max? }`, where `alphabet` is the body of a regular expression character class that allows at least one printable ASCII character (`"a-zA-Z0-9"`) and `min` and `max` are positive integers bounding the id length. Mistral's format is `{ alphabet: "a-zA-Z0-9", min: 9, max: 9 }`. `detect` rejects anything else with `invalid_driver`. Without it, ids pass through unchanged (Anthropic client) or are made Anthropic-valid (OpenAI client with an Anthropic upstream). A driver without `fields` passes only the standard Chat Completions fields; the vLLM extension fields (`top_k`, `min_p`, `repetition_penalty`, ...) are no longer let through for it, so a third-party driver for a server that understands them must list them (the list is `VLLM_FIELDS` in `src/lib/passthrough.mjs`).
- `detect.mjs`: `detect({ endpoint, transport, signal, timeout, probes }) → facts | null`. Return `null` for "not this backend". A thrown error counts as no match. Ask for paths with `http.probe(context, path)` (from `lib/http.mjs`) so a path another driver already fetched is not fetched again. A driver that talks to its backend differently from the bearer default (x-api-key, extra headers) passes its own `info()` as a third argument, `http.probe(context, path, info())`; that request is cached apart from the bearer one.
- `settings.mjs`: `settings(facts) → partial settings`. A driver for a server that renders `tool_reference` content parts returns `{ toolSearch: "native" }` here (see [tool search](claude-code.md#tool-search)).
- `probe.mjs`: `probe({ endpoint, transport, facts, ... }) → partial settings`, for checks that need a request (vLLM uses it for inline system messages).
- `request.mjs`, `response.mjs`, `chunk.mjs`, `flush.mjs`, `error.mjs`: normalizers in the upstream protocol. `request(body, ctx)` and `response(body, ctx)` get the converted body, `chunk(chunk, ctx)` gets each parsed streaming chunk, `flush(ctx) → chunk[]` (needs a `chunk` normalizer) returns chunks the normalizer was still holding when the stream ended, emitted before the final events (on the OpenAI front before `[DONE]`, and before the chunk with the `finish_reason` and the usage-only chunk, which a driver that has `flush` has held back until the stream ends), `error(status, body, ctx)` gets an error body before it is rendered for the client.
- `path.mjs`: `path(kind, { endpoint, model }) → path`, for a backend whose URLs depend on the upstream or the model. `kind` is `"chat"`, `"messages"`, `"embeddings"` or `"models"`; the result (with any query string) replaces `info().paths[kind]` for that call. The Azure driver builds the deployment path and `api-version` this way.
- `token/count.mjs` and `model/list.mjs`: exact token counting and a live model listing.

## Detection

`createTranslator` binds every upstream during creation. Upstreams with `backend: "auto"` (the default) are probed with the drivers in `info().order`; the first driver whose `detect` returns facts wins. The generic `compatible` driver always matches, so detection cannot fail outright. If the server did not answer at all, `compatible` is bound with `facts.reachable === false` and one `detect` warning is emitted (printed on the console when `logs` is on, see [events.md](events.md)).

- Servers that no earlier driver claims (a generic OpenAI-compatible server on any host that is not a hosted API) are sent the later drivers' probes at startup: `GET /props`, `/info`, `/get_server_info`, `/.well-known/localai.json`, `/api/v0/models` and `/api/version`, with the upstream's bearer key like every other probe, plus `GET /v1/models` with the Anthropic headers (see below), in parallel and bounded by `detectTimeout`. Set `backend` to skip them.
- Detection costs the slowest probe, not their sum. Host-name drivers need no network. At the first driver that declares `probes`, the paths of every remaining driver are requested in parallel, and each path is requested once per upstream and shared (`GET /v1/models` is fetched once for vLLM, llama.cpp and the generic driver). A server that matches an earlier driver, vLLM first, is never asked for the later drivers' paths.
- Set `backend: "vllm"` (or any driver name) on an upstream to skip detection and all probing for it. `version` can be supplied so version-mapped settings still apply.
- Set `detect: false` on the translator to skip every request. Auto upstreams are then bound to `compatible`.
- `await api.detect()` re-probes at any time and returns the same report as `api.status()`.

### What each probe does

- vLLM: `GET /version` and `GET /v1/models` in parallel. Facts are `{ version, models, maxModelLen }`. After binding, when the resolved `inlineSystem` is still `auto`, `POST /tokenize` is called with `[system, user, system, user]`; success means the chat template tolerates inline system messages (`keep`), failure means they are folded into the neighbouring user turn (`user`). Unless `images` is configured, a one-token chat completion with a 1x1 image is also sent: a `400` saying the model is not multimodal sets `images: false` (so images and PDF page images become text notes instead of failing every request), success keeps `images: true`, and any other answer (including a timeout) leaves the default. Settings you configure yourself are never probed.
- llama.cpp: `GET /props` (fields `default_generation_settings`, `total_slots` or `build_info`) and `GET /v1/models` (`owned_by: "llamacpp"`). Facts are `{ models, build, vision }`; `vision` comes from `modalities.vision` in newer builds and sets `images`.
- SGLang: `GET /get_server_info` and `GET /v1/models` (`owned_by: "sglang"`). Facts are `{ version, models, modelPath, reasoningParser, toolCallParser }`. SGLang also answers `/version`, so vLLM detection steps aside when `/v1/models` names `sglang` or `llamacpp`, and, when a server answers `/version` without naming itself vLLM (for example because its model list failed), when `/get_server_info` or `/props` identify SGLang or llama.cpp. A real vLLM server names itself in `/v1/models` and is never asked for those paths.
- Hugging Face TGI: `GET /info`, the router's description of itself. Bound only when `router` is `"text-generation-router"` (Text Embeddings Inference also answers `/info`, as `text-embeddings-router`), `model_id` and `version` are strings and `max_total_tokens` is a number. Facts are `{ version, model, maxInputTokens, maxTotalTokens }`. TGI answers `/v1/models` (with `owned_by` set to the model id) but has no `/version`; vLLM still asks for `/info` when a server answers `/version` without naming itself vLLM, and steps aside for TGI.
- LocalAI: `GET /version` and `GET /.well-known/localai.json` (plus the shared `GET /v1/models` for the model list). LocalAI's `/version` reply is `{ "version": "<version> (<commit>)" }` (the commit is empty in a source build), where vLLM and SGLang answer a bare version, so that shape is enough to bind it; the discovery document (a string `version` and an `endpoints` map with `models: "/v1/models"` and `chat_completions: "/v1/chat/completions"`) is the second way in, for releases or proxies where `/version` is not usable. Facts are `{ version, models }`. Because LocalAI answers `/version`, vLLM detection steps aside for that shape without an extra request. LocalAI's other identifying routes (`/system`, `/backends`) need an admin key when API keys are enabled, so they are not used.
- LM Studio: `GET /api/v0/models`, LM Studio's REST listing. Bound only when `object` is `"list"`, `data` is a non-empty array and every entry has `object: "model"`, string `id`, `arch`, `compatibility_type` and `state`, and a `type` of `llm`, `vlm` or `embeddings`; OpenAI's plain `/v1/models` shape or any other server's reply can never pass. Facts are `{ models, loaded }`: the ids of the chat models (embedding models left out) and those with `state: "loaded"`.
- Ollama: `GET /api/version` (and the shared `GET /v1/models` for the model list). Facts are `{ version, models }`.
- Anthropic: `api.anthropic.com` is matched by host name with no request. Any other host is asked for `GET /v1/models` with `anthropic-version` and the upstream's key as `x-api-key` (no bearer header), and is bound only when the answer is an Anthropic model list: no `object` key, a boolean `has_more`, `first_id` and `last_id` that are null or strings and name the first and last entry of `data` (both null when it is empty), and every entry has `type: "model"`, a string `id` and a string `display_name`. OpenAI's `{ object: "list", data: [{ id, object: "model" }] }` can never pass, and a server that answers with the OpenAI shape whatever headers it is sent stays on the generic driver. Facts are `{ models }`, so the served model list comes from the server. The driver is tried at order 38, after the host-name drivers and before llama.cpp. The request is sent together with the other later probes, so it adds one request but no round trip, and it is a separate request from the bearer `GET /v1/models` the other drivers share because the headers differ. A server that requires a key and has none configured answers 401 and is not detected; set `apiKey`, or `backend: "anthropic"`.
- OpenAI, Azure OpenAI, DeepSeek, Mistral and OpenRouter: a host-name check, no request of their own. (vLLM is tried first and probes any host; a hosted API answers it with a 404 or an error.)
- Generic: `GET /v1/models` for reachability and the served model ids.

### Tool-call ids for backends with a strict format

A driver that declares `toolCallIds` gets the client's tool-call ids rewritten into its format, in both directions: Anthropic client to an OpenAI-style server (`tool_use` and `tool_result` ids become `tool_calls[].id` and `tool_call_id`) and OpenAI client to an Anthropic-protocol upstream. The translator keeps no state between requests, so the mapping is a pure function of the request. An id that already satisfies the policy passes through unchanged, so history replayed from the upstream's own ids keeps its ids. Any other id becomes a SHA-256 hash of itself written in the allowed alphabet, `min` characters long when `min` and `max` are equal, otherwise 16 characters clamped into the range. The same client id gets the same value on every request, and a call and the result that answers it always get the same value. Every id of the request is looked at before any is rewritten: conforming ids are reserved first, and when a hash lands on a reserved or already used value the hash is taken again with a counter, so two different originals never share an id. A format with too few free ids for the conversation fails the request with `invalid_request` rather than looping.

Rewritten ids are recorded in the conversion state as `toolIds` (`{ rewritten: original }`). In a reply, an id found there is restored to the client's original (non-streaming and streaming). Ids the upstream makes itself pass through to the client as they were, with the same sanitizing to the Anthropic pattern that an OpenAI-style reply already gets on the Anthropic front. The `mistral` driver declares `toolCallIds`; a third-party driver does it in `info.mjs`.

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
- With tools, DeepSeek requires the `reasoning_content` of earlier turns to be sent back. The driver turns `reasoningRoundTrip` on: the reasoning text of each reply is written into its thinking block's `llmt:` signature and restored exactly on the next request, so a conversation works even when the client dropped or rewrote the thinking text, as long as it keeps the signature. When neither the signature nor any thinking text comes back (a client that discards thinking blocks, or `clear_thinking` removing old turns), the turn is sent without reasoning, one warning is printed per upstream, and DeepSeek's 400 gets an explanation. See [decision D-46](decisions.md).

Nothing here has been run against the real API: the `/v1` paths, the model names that mean thinking mode and the error wording are from the DeepSeek documentation (tracked in [#70](https://github.com/CLDMV/llm-translator/issues/70)). See [decision D-44](decisions.md).

## Mistral API

What the `mistral` driver changes compared with the generic one:

- Tool-call ids are declared as `{ alphabet: "a-zA-Z0-9", min: 9, max: 9 }`, so history replayed from an Anthropic client (or an OpenAI client with other ids) is sent with valid 9-character ids, and the ids Mistral returns map back to the client's originals.
- `seed` is sent as `random_seed` (Mistral's name for it), and `tool_choice: "required"` is sent as `"any"`. A named function and `auto`/`none` stay as they are.
- Reasoning models answer with `content` as a list of typed chunks: `{ type: "text", text }` and `{ type: "thinking", thinking: [{ type: "text", text }] }`. The response normalizer turns the text chunks into `content` and the thinking chunks into `reasoning_content`, which becomes `thinking` and `text` blocks. While streaming, `delta.content` is a list during thinking, a list with the closing thinking chunk and the first text chunk at the switch, and a plain string afterwards; the chunk normalizer handles all three. Other chunk types are skipped.
- `reasoningField: "reasoning_content"`, `maxTokensField: "max_tokens"`, `topK: false`, `prefill: "none"`, and no thinking switch. Reasoning thinking blocks are not sent back to Mistral.

Nothing here has been run against the real API: the field names, the id format and the chunk shapes are from the [Mistral API reference](https://docs.mistral.ai/api/) and its [reasoning guide](https://docs.mistral.ai/capabilities/reasoning/), and real-backend validation is tracked in [#70](https://github.com/CLDMV/llm-translator/issues/70).

## LM Studio

What the `lmstudio` driver changes compared with the generic one:

- It is found through `GET /api/v0/models`, which only LM Studio answers in that shape (see Detection), and it declares that path in `info().probes`, so the request is shared with and bounded like every other probe (`detectTimeout`, once per upstream).
- Settings are the generic conservative set: no `top_k`, no prefill, no thinking switch, usage on the last content chunk.
- Streamed tool calls whose later chunks carry `id: null` (LM Studio sends the id only on the first fragment) stay one `tool_use` block. The shared stream converter treats a `null` id the same as a missing one, with or without an `index`. Models without native tool support use prompt-based calls and can leave text in `content` next to the call; that text is passed through as a `text` block.
- LM Studio also serves an Anthropic-compatible `POST /v1/messages` ([LM Studio docs](https://lmstudio.ai/docs/developer/anthropic-compat)). To use it instead of the OpenAI-style translation, set `backend: "anthropic"` on the upstream, for example `{ url: "http://localhost:1234", backend: "anthropic" }`; the request is then forwarded as Anthropic Messages and none of this driver's handling applies. Which of the two works better depends on the model, and neither has been compared.

Nothing here has been run against a real LM Studio server: the `/api/v0/models` shape and the Anthropic endpoint come from the LM Studio documentation, and real-backend validation is tracked in [#70](https://github.com/CLDMV/llm-translator/issues/70) (epic [#62](https://github.com/CLDMV/llm-translator/issues/62)).

## Azure OpenAI

What the `azure` driver changes compared with the generic one:

- Bound by host name: `*.openai.azure.com`, `*.cognitiveservices.azure.com` and `*.services.ai.azure.com`. The upstream URL is the resource endpoint, for example `https://my-resource.openai.azure.com`; a pasted `.../openai/v1` base URL works too.
- The key is sent in the `api-key` header, not `Authorization: Bearer`. Probes and model listing use the same header.
- Two URL forms. By default the v1 API is used: `<endpoint>/openai/v1/chat/completions`, with the model in the body and no `api-version`. Setting `apiVersion` on the upstream selects the classic form instead: `<endpoint>/openai/deployments/<deployment>/chat/completions?api-version=<apiVersion>`. The deployment is the upstream's `deployment`, or the request's model when that is not set. Embeddings follow the same two forms (`.../embeddings`); the model list is `/openai/v1/models` or `/openai/models?api-version=...`. Azure lists base models there, not the resource's deployments, so set `models` on the upstream to name the deployments it serves.
- `apiVersion` and `deployment` are upstream fields, next to `url`, `apiKey` and `backend`: `{ url: "https://my-resource.openai.azure.com", apiKey: "...", apiVersion: "2024-10-21", deployment: "gpt-4o-prod" }`. Both are non-empty strings; the config is rejected otherwise.
- `maxTokensField: "max_completion_tokens"` (reasoning deployments such as the o-series and gpt-5 need it), `reasoning_effort` for thinking and effort, `topK: false`, `prefill: "none"`, as for the OpenAI driver. An `apiVersion` dated before `2024-09-01` (which does not know `max_completion_tokens`) gets `max_tokens` instead.
- Content filter. A choice with `finish_reason: "content_filter"` ends the Anthropic reply with `stop_reason: "refusal"`, and its `content_filter_results` give the refusal category (`general_harms` when a harm category was filtered). A prompt that is refused outright answers HTTP 400 with `error.code: "content_filter"`; the error keeps its code and `param`, and its message lists the categories named as filtered in `innererror.content_filter_result`.

Nothing here has been run against the real API: the URL forms, the `api-key` header and the content filter shapes are from the Microsoft Learn pages on the [v1 API](https://learn.microsoft.com/en-us/azure/ai-foundry/openai/api-version-lifecycle) and [content filtering](https://learn.microsoft.com/en-us/azure/ai-foundry/openai/concepts/content-filter), and real-backend validation is tracked in [#70](https://github.com/CLDMV/llm-translator/issues/70). Microsoft Entra ID (bearer token) authentication, sovereign cloud hosts such as `openai.azure.us`, and the preview features behind `api-version=preview` on the v1 path are not handled.

## OpenRouter

What the `openrouter` driver changes compared with the generic one:

- Bound by host name `openrouter.ai`. The API lives under `/api`, so the driver's `path` leaf puts `/api` in front of the usual `/v1/...` paths unless the upstream URL already ends in it. `https://openrouter.ai`, `https://openrouter.ai/api` and `https://openrouter.ai/api/v1` (the config removes the `/v1`) all reach `https://openrouter.ai/api/v1/chat/completions`.
- `reasoningRoundTrip` is on. OpenRouter wants the `reasoning_details` of the previous turn back unmodified and in order, which matters most when tools are involved. The items (`reasoning.text` with an optional `signature`, `reasoning.summary`, `reasoning.encrypted`, each with `id`, `format` and `index`) ride in the thinking block's `llmt:` signature and are put back on the assistant message in the order they arrived, next to the `reasoning` text. Streamed fragments of one item (same `index` and `type`) are merged into one item. An OpenAI client talking to OpenRouter gets the replies and sends its history through as it is.
- Reasoning controls are sent as OpenRouter's `reasoning` object, never both `effort` and `max_tokens`. `output_config.effort` (or the `reasoning_effort` of an OpenAI client) becomes `reasoning: { effort }`, thinking `enabled` with no effort becomes `medium`, and `thinking: { type: "disabled" }` becomes `reasoning: { effort: "none" }`. Thinking `enabled` with a `budget_tokens` and no effort becomes `reasoning: { max_tokens }`, capped at one below the request's `max_tokens`. A `reasoning` object the client sends itself (OpenAI front) is kept as it is, so `exclude` and `enabled` are available there. The `efforts` and alias pins apply to the effort as for any OpenAI-protocol upstream.
- Errors inside a successful reply. OpenRouter can answer HTTP 200 with `choices[i].error` (`{ code, message, metadata }`, `finish_reason: "error"`) when the provider fails while generating, or with a top-level `error` and no choices. When every choice carries an error (or there are no choices and the reply has an `error`), the reply becomes an upstream error: its status is the error's numeric `code` when that is 400 to 599 (else 502), its code is `metadata.error_type`, and the message names `metadata.provider_name`. Partial text of the failed choice is dropped. In a stream, an error chunk (a top-level `error` with `finish_reason: "error"`) ends an Anthropic-front stream with an `error` event, and an error found only on a choice is moved to the top level first so it ends the stream the same way; an OpenAI-front stream is forwarded as OpenRouter sent it, apart from that same move of a choice error to the top level.
- Comment lines (`: OPENROUTER PROCESSING`) are skipped by the SSE parser. The last chunk before `[DONE]` carries `usage` together with one choice with an empty delta that repeats the `finish_reason`; it is read as usage only and produces no second stop.
- `reasoningField: "reasoning"`, `maxTokensField: "max_tokens"`, `topK: true`, `prefill: "none"` (a trailing assistant message is OpenRouter's own prefill), `streamUsage: true`.

Nothing here has been run against the real API: the field names and shapes are from the OpenRouter documentation on [reasoning tokens](https://openrouter.ai/docs/use-cases/reasoning-tokens), [errors](https://openrouter.ai/docs/api-reference/errors) and [streaming](https://openrouter.ai/docs/api-reference/streaming), and real-backend validation is tracked in [#70](https://github.com/CLDMV/llm-translator/issues/70). Provider routing options (`provider`, `models`, `route`), OpenRouter's usage `cost` field and its app attribution headers are not special-cased; they can be set through `headers` on the upstream and, for the request fields, the OpenAI front.

## Hugging Face TGI

What the `tgi` driver changes compared with the generic one:

- It is found through `GET /info` (see Detection) and declares that path in `info().probes`, so the request is shared with and bounded like every other probe.
- Settings: `maxTokensField: "max_tokens"`, `topK: false` (the chat request has no `top_k`), `prefill: "none"`, `thinking: "none"`, `responseFormat: true`, usage on the last content chunk.
- Structured output goes in `response_format`, which on TGI's chat endpoint is the grammar. The Anthropic front's `output_config.format` and an OpenAI `{ type: "json_schema", json_schema: { name, schema, strict } }` are sent as `{ type: "json_schema", value: { name, schema } }`; `strict` is dropped. A bare `{ type: "json_object" }` has no schema, so it is sent as `{ type: "json", value: { type: "object" } }`. A client that sends TGI's own `grammar` (`{ type: "json" | "regex", value }`) has it moved into `response_format` unless `response_format` is set, and the OpenAI front's `passthroughFilter` lets `grammar` through for TGI upstreams only. TGI refuses a request that has both tools and a grammar, so when both are present the tools are kept and `response_format` is dropped (listed in the `dropped` event).
- Responses and streams are put into the standard shape, which matters for older TGI releases that deviated from it: `tool_calls` as one object instead of a list, numeric tool-call ids (`id: 0`), `arguments` as an object (or under the older name `parameters`) instead of a JSON string, and the `eos_token` and `stop_sequence` finish reasons. The last two become `stop`, or `tool_calls` when the answer holds calls (older TGI reported `eos_token` for those too), so an OpenAI client never sees a finish reason it does not know; an Anthropic client gets `end_turn` or `tool_use`. In streams, a fragment with an empty `id` continues the call that is open. Current TGI already answers in the standard shape, and such replies pass through unchanged.
- TGI ignores `n` and `logit_bias`, and `tool_choice` takes `auto`, `none`, `required` or a function name. Reasoning models are not special-cased: TGI has no reasoning field, so any `<think>` block stays in `content` and `thinkTags` reads it as for any server.

TGI is in maintenance mode upstream; the driver targets its latest release and the historic behaviour above. Nothing here has been run against a real TGI server: the `/info` fields, the grammar shapes (from TGI's OpenAPI document and router source) and the historic tool-call shapes (from TGI's guidance documentation) are unverified, and real-backend validation is tracked in [#70](https://github.com/CLDMV/llm-translator/issues/70) (epic [#62](https://github.com/CLDMV/llm-translator/issues/62)).

## LocalAI

What the `localai` driver changes compared with the generic one:

- It is found through `GET /version` or `GET /.well-known/localai.json` (see Detection) and declares both in `info().probes`.
- Settings: `reasoningField: "reasoning"`, `maxTokensField: "max_tokens"`, `topK: true`, `thinking: "chat_template_kwargs"`, `prefill: "none"`, usage on the last content chunk. LocalAI puts a model's reasoning in `message.reasoning` (and the same field in stream deltas); it accepts `reasoning_content` on input as an alias. The translator reads either name from a reply, so reasoning becomes `thinking` blocks in both cases, and reasoning sent back on a later turn uses `reasoning`. Where a model keeps its thinking inline in `content`, `thinkTags` reads the `<think>` block as for any server.
- LocalAI's extra request fields (`top_k`, `min_p`, `repeat_penalty`, `repeat_last_n`, `ignore_eos`, `typical_p`, `chat_template_kwargs` and `grammar`) pass the OpenAI front's `passthroughFilter` for LocalAI upstreams only, and vLLM's `repetition_penalty` is sent as `repeat_penalty`.
- Parallel tool calls are a model setting on LocalAI, not a request option: `function.parallel_calls` in the model's YAML decides whether one reply may hold several tool calls, and the server does not read `parallel_tool_calls`. The translator therefore cannot turn parallel calls on from the client side. It can hold them back: when an Anthropic client sets `disable_parallel_tool_use`, the driver removes `parallel_tool_calls` from the request and keeps only the first tool call of each reply and each stream, so a model configured for parallel calls still behaves as the client asked. An OpenAI client's `parallel_tool_calls: false` is forwarded as sent and has no effect on LocalAI, because the response side of a same-protocol request cannot see the request. To allow parallel calls, set `function.parallel_calls: true` on the model (LocalAI marks it experimental); to forbid them, leave it unset.
- Tool calls as plain text: LocalAI turns the model's output into `tool_calls` itself (llama.cpp's own parser, or a grammar, or the `function:` regexes), and when that does not match the model's format the call stays in `content` as text, for example `{"name": "get_weather", "arguments": {...}}` or an XML-style block. The translator forwards `content` as it is, so a client then sees a text block (or an assistant text message) where it expected a `tool_use`, and the turn ends with `end_turn`. The fix is on the LocalAI side, in the model's YAML: use the model's gallery configuration (it sets the right parser and chat template), set `function.automatic_tool_parsing_fallback: true` and `function.disable_no_action: true` for models whose parser returns calls as text, or give `function.response_regex` / `function.json_regex_match` that match the model's call format (with `function.no_grammar: true` when grammars are not used). Grammar-based tool calling works with the llama.cpp backend only. The translator does not parse tool calls out of text itself.

Nothing here has been run against a real LocalAI server: the `/version` and discovery shapes, the `reasoning` field, the request fields and the `function:` options come from the LocalAI source and [documentation](https://localai.io/docs/features/openai-functions/), and real-backend validation is tracked in [#70](https://github.com/CLDMV/llm-translator/issues/70) (epic [#62](https://github.com/CLDMV/llm-translator/issues/62)).

## SGLang

What the `sglang` driver changes compared with the generic one:

- `reasoningField: "reasoning_content"`, `maxTokensField: "max_completion_tokens"`, `topK: true`, `prefill: "none"`, `thinking: "chat_template_kwargs"`.
- When `/get_server_info` shows the server runs with a `--reasoning-parser`, requests carry `separate_reasoning: true` (unless the client set it), so the model's thinking arrives in `reasoning_content` and becomes `thinking` blocks. Without a parser the reasoning stays inline in `content` and `thinkTags` reads a leading `<think>` block as before (use `thinkOpen` for templates that open the tag in the prompt).
- Streams that carry `reasoning_content` deltas, text and tool calls convert to `thinking`, `text` and `tool_use` blocks like any other OpenAI-protocol upstream.
- SGLang's `regex`, `ebnf` and `separate_reasoning` fields pass the OpenAI front's `passthroughFilter` for SGLang upstreams only (a driver lists its own fields in `info().fields`), so an OpenAI client can send them to SGLang and they are stripped for every other backend, api.openai.com included. llama.cpp does the same for `repeat_penalty` and `grammar`. vLLM's documented extension fields (`top_k`, `min_p`, `chat_template_kwargs`, `thinking_token_budget` and the rest) are listed by the `vllm` and `compatible` drivers, so generic servers see no change; llama.cpp and SGLang list the ones they accept, and api.openai.com, DeepSeek, Ollama and Anthropic list none, so a client cannot send them there. Forced tool choice (`required` or a named function) is handled by the server (it builds an EBNF grammar itself); the driver passes `tool_choice` through.

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

`reasoning_effort` is clamped to `low`, `medium` or `high` (`xhigh` and `max` become `high`) because vLLM rejects other values; set `effortPassthrough: true` in the upstream's settings to send the client's value unchanged. A model with a configured `efforts` list is not clamped: its list decides (see [settings.md](settings.md#effort-levels-and-pinned-aliases-not-converter-settings)).

Reading is never version dependent: the converters accept `reasoning`, `reasoning_content` and `<think>` tags in content.

## Precedence

For every setting the winner is, from highest to lowest: the upstream's own `settings`, the translator's global `settings`, probed values, driver settings, library defaults. The `inlineSystem` probe only runs when nothing above it set the value.

## Routing

`request(body)` picks the upstream for `body.model`:

1. The alias map (`aliases: { "claude-haiku-5-5": "qwen3-coder" }`) rewrites the model name sent upstream. The client still sees the name it asked for in responses. An alias written as `{ "model": "qwen3-coder", "effort": "high" }` also pins settings (see [settings.md](settings.md#effort-levels-and-pinned-aliases-not-converter-settings)).
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
