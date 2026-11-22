# Drivers, detection and routing

A driver teaches the translator how one kind of upstream server behaves: which protocol it speaks, how to recognize it, which converter settings suit it, and any small normalizations it needs. Consumer code never names a backend; each upstream is bound to a driver once at startup.

## Architecture

Drivers are slothlet leaves under `api/driver/<name>/`, mounted at `api.driver.<name>`. The built-in set:

| Driver       | Protocol             | Speaks                             | Order | Matches                                                                                                                                 |
| ------------ | -------------------- | ---------------------------------- | ----- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `vllm`       | `openai.chat`        | `messages`, `chat`, `responses`    | 10    | `GET /version` returns a version, or `GET /v1/models` lists a model with `owned_by: "vllm"`                                             |
| `groq`       | `openai.chat`        | `chat`                             | 21    | host `api.groq.com` (no request of its own)                                                                                             |
| `together`   | `openai.chat`        | `chat`                             | 22    | host `api.together.ai`, `api.together.xyz` or `us-api.together.ai` (no request of its own)                                              |
| `fireworks`  | `openai.chat`        | `chat`                             | 23    | host `api.fireworks.ai` (no request of its own)                                                                                         |
| `xai`        | `openai.chat`        | `chat`                             | 24    | host `api.x.ai` (no request of its own)                                                                                                 |
| `gemini`     | `openai.chat`        | `chat`, `google.gemini`            | 25    | host `generativelanguage.googleapis.com` (no request of its own; the native `generateContent` API for an upstream with `api: "gemini"`) |
| `openai`     | `openai.chat`        | `chat`, `responses`                | 30    | host `api.openai.com` (no network access)                                                                                               |
| `deepseek`   | `openai.chat`        | `chat`                             | 35    | host `api.deepseek.com` (no request of its own)                                                                                         |
| `azure`      | `openai.chat`        | `chat`                             | 32    | host `*.openai.azure.com`, `*.cognitiveservices.azure.com` or `*.services.ai.azure.com` (no request of its own)                         |
| `mistral`    | `openai.chat`        | `chat`                             | 36    | host `api.mistral.ai` (no request of its own)                                                                                           |
| `openrouter` | `openai.chat`        | `chat`                             | 37    | host `openrouter.ai` (no request of its own)                                                                                            |
| `anthropic`  | `anthropic.messages` | `messages`                         | 38    | host `api.anthropic.com` (no request), or `GET /v1/models` answers with an Anthropic model list                                         |
| `vertex`     | `anthropic.messages` | `messages`, `google.gemini`        | 39    | host `aiplatform.googleapis.com` or `<region>-aiplatform.googleapis.com` (no request of its own)                                        |
| `llamacpp`   | `openai.chat`        | `chat`, `responses`                | 40    | `GET /props` has llama-server fields, or `GET /v1/models` lists `owned_by: "llamacpp"`                                                  |
| `tgi`        | `openai.chat`        | `chat`                             | 45    | `GET /info` is Text Generation Inference's router description (strict shape check)                                                      |
| `localai`    | `openai.chat`        | `chat`, `responses`                | 52    | `GET /version` is `<version> (<commit>)`, or `GET /.well-known/localai.json` is LocalAI's discovery document                            |
| `sglang`     | `openai.chat`        | `chat`, `responses`                | 50    | `GET /get_server_info` has `model_path`, or `GET /v1/models` lists `owned_by: "sglang"`                                                 |
| `lmstudio`   | `openai.chat`        | `chat`, `responses`                | 55    | `GET /api/v0/models` is LM Studio's model listing (strict shape check)                                                                  |
| `ollama`     | `openai.chat`        | `chat`, `responses`, `ollama.chat` | 60    | `GET /api/version` returns a version (its own chat API for an upstream with `api: "ollama.chat"`)                                       |
| `cohere`     | `openai.chat`        | `chat`, `cohere.chat`              | 26    | host `api.cohere.com` or `api.cohere.ai` (no request of its own)                                                                        |
| `bedrock`    | `anthropic.messages` | `messages`, `bedrock.converse`     | 33    | host `bedrock-runtime.<region>.amazonaws.com` (no request of its own; also `backend: "bedrock"`)                                        |
| `compatible` | `openai.chat`        | `chat`, `responses`                | 100   | always; the fallback for servers without a driver                                                                                       |

A driver folder contains these files, all optional except `info`:

- `info.mjs`: `info() → { name, protocol, protocols, order, auth, strict?, n?, hosts?, headers?, probes?, fields?, toolCallIds?, paths }`. `n: false` says the server has no `n` parameter (Chat Completions' number of choices), so a request for several choices is answered with parallel requests even on a pass-through route. `strict` says whether the backend enforces `strict` tool use (`true` for `anthropic`, `openai` and `vllm`, which enforces it when started with strict tool calling, `--tool-strict-level`; `false` or absent for the others): a request with a strict tool sent to a driver without it gets a `strict` warning that the tool is not enforced. `auth` is `"bearer"`, `"x-api-key"` or `"api-key"` (Azure OpenAI), `headers` are sent on every request (the Anthropic driver adds `anthropic-version`), `protocol` is the driver's own protocol (what a request is converted to when nothing else is asked for), `protocols` lists every protocol the driver's server speaks (`"anthropic.messages"`, `"openai.chat"`, `"openai.responses"`, `"ollama.chat"`; the driver's own `protocol` is always counted), which is what the upstream's `api` setting chooses from (see [Choosing the protocol](#choosing-the-protocol-api)), a driver can declare `protocol: "openai.responses"` itself, so that every upstream bound to it speaks the Responses API, and name its path in `paths.responses` (default `/v1/responses`), `native` (optional) is `{ protocol, paths }`: the paths a second mode replaces when the upstream uses it (Ollama: `ollama.chat`, `/api/chat`), `paths` names the chat or messages path (and optionally `embeddings` and `models`, which default to `/v1/embeddings` and `/v1/models`), `probes` lists the GET paths `detect` will ask for (see Detection), `hosts` lists host names the driver matches without a request, and `hostSuffixes` (optional) host name endings it matches the same way (Azure OpenAI's `.openai.azure.com`; a driver that lists `probes` and matches the upstream's host does not start the batched probes; the Anthropic driver lists `api.anthropic.com`; the hosted drivers and the presets list theirs, see Detection), and `fields` lists the extra request fields the OpenAI front's `passthroughFilter` lets through to this backend. `fields` must be an array of strings (or absent); `detect` rejects anything else with `invalid_driver`. `toolCallIds` (optional) describes a backend with a strict tool-call id format: `{ alphabet, min?, max? }`, where `alphabet` is the body of a regular expression character class that allows at least one printable ASCII character (`"a-zA-Z0-9"`) and `min` and `max` are positive integers bounding the id length. Mistral's format is `{ alphabet: "a-zA-Z0-9", min: 9, max: 9 }`. `detect` rejects anything else with `invalid_driver`. Without it, ids pass through unchanged (Anthropic client) or are made Anthropic-valid (OpenAI client with an Anthropic upstream). A driver without `fields` passes only the standard Chat Completions fields; the vLLM extension fields (`top_k`, `min_p`, `repetition_penalty`, ...) are no longer let through for it, so a third-party driver for a server that understands them must list them (the list is `VLLM_FIELDS` in `src/lib/passthrough.mjs`).
- `detect.mjs`: `detect({ endpoint, transport, signal, timeout, probes }) → facts | null`. Return `null` for "not this backend". A thrown error counts as no match. Ask for paths with `http.probe(context, path)` (from `lib/http.mjs`) so a path another driver already fetched is not fetched again. A driver that talks to its backend differently from the bearer default (x-api-key, extra headers) passes its own `info()` as a third argument, `http.probe(context, path, info())`; that request is cached apart from the bearer one.
- `settings.mjs`: `settings(facts) → partial settings`. A driver for a server that renders `tool_reference` content parts returns `{ toolSearch: "native" }` here (see [tool search](claude-code.md#tool-search)).
- `probe.mjs`: `probe({ endpoint, transport, facts, ... }) → partial settings`, for checks that need a request (vLLM uses it for inline system messages).
- `request.mjs`, `response.mjs`, `chunk.mjs`, `flush.mjs`, `error.mjs`: normalizers in the upstream protocol. `request(body, ctx)` and `response(body, ctx)` get the converted body, `chunk(chunk, ctx)` gets each parsed streaming chunk, `flush(ctx) → chunk[]` (needs a `chunk` normalizer) returns chunks the normalizer was still holding when the stream ended, emitted before the final events (on the OpenAI front before `[DONE]`, and before the chunk with the `finish_reason` and the usage-only chunk, which a driver that has `flush` has held back until the stream ends), `error(status, body, ctx)` gets an error body before it is rendered for the client.
- `path.mjs`: `path(kind, { endpoint, model, protocol, stream }) → path`, for a backend whose URLs depend on the upstream or the model. `kind` is `"chat"`, `"messages"`, `"converse"`, `"embeddings"` or `"models"` (`protocol` is the one the request goes over, which is how a driver puts a native protocol at its own URL); the result (with any query string) replaces `info().paths[kind]` for that call. The Azure driver builds the deployment path and `api-version` this way.
- `auth.mjs`: `auth({ endpoint, headers, transport, timeout }) → headers`, for a backend whose credentials have to be fetched. It gets the headers the request would send and returns the ones to send; it runs for every request except a token count (which builds its own headers) and may be asynchronous. The Vertex AI driver adds a Google access token as the bearer token here.
- `sign.mjs`: `sign({ endpoint, protocol, method, url, headers, body, stream }) → headers`, for a backend that authenticates each call over its finished URL, headers and body (Amazon Bedrock's SigV4). The result replaces the headers of the upstream request. `info().frames: "eventstream"` marks a server whose streams are binary event stream frames instead of SSE.
- `token/count.mjs` and `model/list.mjs`: exact token counting and a live model listing.

## Detection

`createTranslator` binds every upstream during creation. Upstreams with `backend: "auto"` (the default) are probed with the drivers in `info().order`; the first driver whose `detect` returns facts wins. Drivers that name the endpoint's host in `info().hosts` or `info().hostSuffixes` go first, whatever their `order`, so a hosted upstream (`api.groq.com`, `api.openai.com`, an Azure resource) is bound with no request at all and never reaches vLLM's `GET /version` and `GET /v1/models`; every other upstream is probed in `order` as before. The generic `compatible` driver always matches, so detection cannot fail outright. If the server did not answer at all, `compatible` is bound with `facts.reachable === false` and one `detect` warning is emitted (printed on the console when `logs` is on, see [events.md](events.md)).

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
- Vertex AI: a host-name check (`aiplatform.googleapis.com` and `<region>-aiplatform.googleapis.com`), no request of its own. A Vertex AI URL behind a proxy or gateway has another host name, so set `backend: "vertex"` for it.
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

## Google Vertex AI (Claude and Gemini)

What the `vertex` driver changes compared with the native Anthropic one. It serves Anthropic's Claude models through Vertex AI's raw endpoint over the Messages protocol (`anthropic.messages`), and Google's Gemini models through `generateContent` over `google.gemini` (see [Gemini on Vertex AI](#gemini-on-vertex-ai) below). Under `api: "auto"` the model id chooses: `gemini-...` goes over `google.gemini`, every other id over `anthropic.messages`.

- Bound by host name (`aiplatform.googleapis.com`, `<region>-aiplatform.googleapis.com`, `aiplatform.us.rep.googleapis.com` and `aiplatform.eu.rep.googleapis.com`) with no request, or by `backend: "vertex"`, which is needed behind a proxy. An Anthropic client's request is forwarded as it is, and an OpenAI client's request is converted to a Messages body first, exactly as for the Anthropic driver.
- The URL is `POST https://<region>-aiplatform.googleapis.com/v1/projects/<project>/locations/<region>/publishers/anthropic/models/<model>:rawPredict`, and `:streamRawPredict` for a streaming request. For the region `global` the host is `aiplatform.googleapis.com`, and the multi-region endpoints `us` and `eu` use `aiplatform.us.rep.googleapis.com` and `aiplatform.eu.rep.googleapis.com` (the region in the path is `us` or `eu`). A model id is used as given, so older models keep the `@` before their date (`claude-sonnet-4-5@20250929`) and newer ones have none (`claude-sonnet-5-5`).
- Vertex AI wants the model in the path and the API version in the body, so the driver adds `anthropic_version: "vertex-2023-10-16"` to the body and removes `model` from it. `stream` stays in the body. The `anthropic-version` and `x-api-key` headers are not sent. A client's `anthropic-beta` header is forwarded, and so are the upstream's own `headers` (for example `x-goog-user-project` to bill another project).
- Token counting uses `POST .../publishers/anthropic/models/count-tokens:rawPredict` with the model in the body. When that answers anything but a count (a 404 from a project or region that does not have it, a network error, no credentials) the character estimate is used instead, as for the other drivers.
- Errors are read from Google's envelope (`{ "error": { "code", "message", "status" } }`, also when it comes wrapped in an array) and from Claude's own (`{ "type": "error", "error": { "type", "message" } }`), and answered in the client's protocol with the HTTP status kept. For an OpenAI client Google's `status` (`NOT_FOUND`, `PERMISSION_DENIED`) is the error `code`.
- Vertex AI has no Models API (Anthropic lists it among the unsupported endpoints), so the driver has no live model list: the model list is the upstream's `models`, and the models are not detected. Set `models` to the ids the project has enabled.
- Anthropic lists what Claude on Vertex AI does not support: URL sources for images and documents, the Files API, the code execution, web fetch and advisor server tools, Agent Skills, the MCP connector, programmatic tool calling, Message Batches and server-side `fallbacks`. The driver forwards a request that uses one and Vertex AI refuses it; nothing is removed from the body.

### Gemini on Vertex AI

A Google-published model (`gemini-2.5-flash`, `gemini-3-pro-preview`, with or without a `models/` or `publishers/google/models/` prefix) is served through the Google publisher: `POST https://<region>-aiplatform.googleapis.com/v1/projects/<project>/locations/<region>/publishers/google/models/<model>:generateContent`, and `:streamGenerateContent?alt=sse` for a stream (the host, region and project rules are the ones above). Everything about the body and the reply is the Gemini API's `google.gemini` protocol, which is what `lib/gemini.mjs` and the converters build ([Gemini native API](#gemini-native-api), [protocol-support.md](protocol-support.md#12-google-gemini-generatecontent)); only the transport differs.

- Choosing it. Under `api: "auto"` a model id that starts with `gemini-` goes over `google.gemini`, and any other id keeps `anthropic.messages`. An explicit `api` wins for every model: `api: "gemini"` sends a tuned or otherwise named model through `generateContent`, and `api: "messages"` keeps `rawPredict`. Both fronts reach it.
- Authentication. The same Google credentials as for Claude (see Authentication below): a bearer access token, never `x-goog-api-key`. The body has no `anthropic_version`, and `model` and `stream` are left out of it (the URL carries both).
- Token counts. `POST .../publishers/google/models/<model>:countTokens` with the prompt as `contents`, `systemInstruction`, `tools` and `toolConfig`; any other answer gives the usual estimate of one token per four characters.
- Thought signatures, thinking budgets and levels, PDFs and every other mapping are the Gemini API's, unchanged. The `v1` API version is used for every call.
- Cached contents. A `cache_control` breakpoint creates the cached content with `POST .../locations/<region>/cachedContents` (the model as `projects/<project>/locations/<region>/publishers/google/models/<model>`), as described for the Gemini API above.
- Model list. The driver has no live list (as for Claude): the upstream's `models` are listed.

Nothing here has been run against real Vertex AI; the paths and fields come from Google's API reference and the tests use a local stand-in ([#70](https://github.com/CLDMV/llm-translator/issues/70)).

### Upstream fields

`vertex` is an upstream field next to `url`, `apiKey` and `backend`. Every key is optional:

```js
{
	backend: "vertex",
	models: ["claude-sonnet-4-5@20250929"],
	vertex: {
		project: "my-project",
		region: "us-east5",
		credentials: "/etc/llm-translator/key.json"
	}
}
```

- `project`: the Google Cloud project id. Without it the driver uses `ANTHROPIC_VERTEX_PROJECT_ID`, `GOOGLE_CLOUD_PROJECT` or `GCLOUD_PROJECT` (in that order), and then the `project_id` (or `quota_project_id`) of the credentials file. Those names are the ones Anthropic's Vertex SDKs and Claude Code read (`ANTHROPIC_VERTEX_PROJECT_ID`) and the ones Google's libraries read. When no project is found the request fails with an `INVALID_CONFIG` error before anything is sent.
- `region`: for example `us-east5`, `europe-west1`, `global`, `us` or `eu`. Without it the region in the upstream's host name is used, then `CLOUD_ML_REGION` (the variable Anthropic's SDKs and Claude Code read).
- `url` is optional for `backend: "vertex"`: it defaults to the region's host (`https://<region>-aiplatform.googleapis.com`, `https://aiplatform.googleapis.com` for `global`), using `region` or `CLOUD_ML_REGION`. Set it to reach Vertex AI through a proxy or a private endpoint, for example Private Service Connect.
- `credentials`, `accessToken`, `getToken` and `metadataServer` choose how requests are authenticated, see the next section.

The command line takes the same from the environment: `llm-translator --upstream https://us-east5-aiplatform.googleapis.com --backend vertex` with `GOOGLE_CLOUD_PROJECT` and `GOOGLE_APPLICATION_CREDENTIALS` set. The JSON config file takes the `vertex` object as it is, except `getToken`, which is a function and so only exists in the library.

### Authentication

Vertex AI takes a Google OAuth 2.0 access token as a bearer token (not an API key). The driver gets one from the first source below that is set, using only `node:crypto` and the translator's own transport, with no Google library. Explicit settings come before the environment.

| Order | Source                                        | How to set it up                                                                                                                                                                                                |
| ----- | --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | `vertex.getToken`                             | A function, sync or async, that returns the token as a string (or `{ token }`). It is called with `{ signal }` for every request and does its own caching. Use it for anything the driver does not read itself. |
| 2     | `vertex.accessToken`                          | A token you got yourself, for example `gcloud auth print-access-token`. It lasts about an hour and is never refreshed.                                                                                          |
| 3     | The upstream's `apiKey`                       | Used as the bearer token, like `accessToken`. This is what `--upstream-key` and `LLM_TRANSLATOR_UPSTREAM_KEY` set.                                                                                              |
| 4     | `vertex.credentials`                          | A service account key or an `authorized_user` file, as an object, as JSON text or as a file path.                                                                                                               |
| 5     | `GOOGLE_ACCESS_TOKEN`                         | The same as `accessToken`, from the environment.                                                                                                                                                                |
| 6     | `GOOGLE_APPLICATION_CREDENTIALS`              | The path of a service account key or `authorized_user` file.                                                                                                                                                    |
| 7     | gcloud's application default credentials file | `~/.config/gcloud/application_default_credentials.json` (`%APPDATA%\gcloud\...` on Windows, or under `CLOUDSDK_CONFIG`), which `gcloud auth application-default login` writes.                                  |
| 8     | The GCE metadata server                       | Only when `vertex.metadataServer` is `true` (or a base URL), because it is a network call to a link-local address. For Compute Engine, GKE and Cloud Run.                                                       |

Setting each one up:

- **Service account key (recommended for a server).** Enable the API and give a service account the Vertex AI user role, then export a key:

  ```bash
  gcloud services enable aiplatform.googleapis.com --project my-project
  gcloud iam service-accounts create llm-translator --project my-project
  gcloud projects add-iam-policy-binding my-project --member serviceAccount:llm-translator@my-project.iam.gserviceaccount.com --role roles/aiplatform.user
  gcloud iam service-accounts keys create key.json --iam-account llm-translator@my-project.iam.gserviceaccount.com
  export GOOGLE_APPLICATION_CREDENTIALS=$PWD/key.json
  ```

  The driver signs an RS256 JWT with the key (scope `https://www.googleapis.com/auth/cloud-platform`), exchanges it at the key's `token_uri`, and caches the token until a minute before it expires. Concurrent requests share one refresh, and a failed refresh is not cached. A key is a long-lived secret: keep the file out of the repository and readable only by the service.

- **Your own account (development).** `gcloud auth application-default login` writes an `authorized_user` file. The driver finds it with no setting, and trades its refresh token for access tokens the same way. A quick alternative is `export GOOGLE_ACCESS_TOKEN=$(gcloud auth print-access-token)`, which expires after an hour.
- **A static token.** `vertex: { accessToken: "ya29...." }` or `apiKey`, for a short-lived run or when something else renews it and restarts the translator.
- **Anything else.** Workload identity federation (`external_account` files), service account impersonation (`impersonated_service_account` files) and similar sources are not read by the driver. Use `getToken` with whatever your environment provides, for example the `google-auth-library` package or a call to `gcloud auth print-access-token`:

  ```js
  import { GoogleAuth } from "google-auth-library";
  const auth = new GoogleAuth({ scopes: "https://www.googleapis.com/auth/cloud-platform" });
  const vertex = { project: "my-project", region: "us-east5", getToken: () => auth.getAccessToken() };
  ```

- **On Google Cloud.** `vertex: { metadataServer: true, project: "my-project", region: "us-east5" }` asks `http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token` with `Metadata-Flavor: Google` and caches the token. The project is not read from the metadata server, so set it. The attached service account needs the Vertex AI user role.

The Claude models also have to be enabled for the project in Model Garden, and not every region serves every model (regional endpoints serve older models only; use `global`, `us` or `eu` for the newest): an unknown model or region answers 404 `NOT_FOUND`. A token problem answers 401 with the cause (`No Google credentials for Vertex AI`, or Google's own refusal such as `invalid_grant`), and a missing role answers 403 `PERMISSION_DENIED`. The token and the key are never written to the status, the events or the capture records.

Nothing here has been run against Google: the URL, the body fields, the endpoint hosts and the unsupported feature list are from Anthropic's page on [Claude Models on Google Cloud (Google managed)](https://platform.claude.com/docs/en/build-with-claude/claude-models-on-google-cloud/google-managed), the `count-tokens` method, the environment variable names, the `anthropic-beta` header and the error envelope are written from memory of Anthropic's and Google's SDKs and need checking against the real service, the token flows follow Google's [OAuth 2.0 for service accounts](https://developers.google.com/identity/protocols/oauth2/service-account), and the tests run against a local stand-in. Real-backend validation is tracked in [#70](https://github.com/CLDMV/llm-translator/issues/70).

## Amazon Bedrock

The `bedrock` driver talks to the Bedrock runtime (`bedrock-runtime.<region>.amazonaws.com`). Claude models go through InvokeModel with an Anthropic Messages body, every other model through Converse.

```js
createTranslator({
	front: "anthropic",
	upstreams: [{ backend: "bedrock", region: "us-east-1", accessKeyId: "AKIA...", secretAccessKey: "..." }]
});
```

- Binding. A URL whose host is `bedrock-runtime.<region>.amazonaws.com` (also the `-fips` form, an interface VPC endpoint and the China partition) is bound by name, with no request. `backend: "bedrock"` binds any URL, which is how a proxy or a local stand-in is used. With `backend: "bedrock"` the `url` may be left out: it defaults to `https://bedrock-runtime.<region>.amazonaws.com`, and the config is rejected when there is no region either.
- Region. The upstream's `region`, else the region in the URL's host name, else `AWS_REGION`, else `AWS_DEFAULT_REGION`. It is the region SigV4 signs for.
- Authentication, most specific first: the upstream's `apiKey` (a Bedrock API key, sent as `Authorization: Bearer`), the upstream's `accessKeyId` and `secretAccessKey` (with `sessionToken` for temporary credentials), then `AWS_BEARER_TOKEN_BEDROCK`, then `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` and `AWS_SESSION_TOKEN`. A call with no credential fails before it is sent (`missing_credentials`, HTTP 500), as does a SigV4 call with no region (`missing_region`). Access keys sign each call with Signature Version 4 for the service `bedrock` (`lib/sigv4.mjs`, `node:crypto` only; the signature covers the exact JSON text sent, so a retry is signed again). The credential chain of the AWS SDK (profiles, SSO, instance roles, `AWS_CONTAINER_*`) is not implemented ([#180](https://github.com/CLDMV/llm-translator/issues/180)): resolve credentials outside and pass them in.
- Model ids. Use the id as Bedrock lists it, an inference profile id with a geography prefix (`us.anthropic.claude-sonnet-4-5-20250929-v1:0`, `eu.`, `apac.`, `global.`), or an ARN. Many newer models can only be called through an inference profile, so the bare id is rejected for them by Bedrock itself. The id goes in the URL path as one percent-encoded segment (`:` is `%3A`, `/` is `%2F`) and is signed double-encoded as SigV4 requires. Aliases (`aliases`) work as for any upstream.
- InvokeModel and Converse. Under `api: "auto"` a Claude id (`anthropic.claude-*`, a prefixed profile id or an ARN of either) goes over `anthropic.messages`: `POST /model/<id>/invoke`, or `/invoke-with-response-stream`, with the Anthropic body, `anthropic_version: "bedrock-2023-05-31"`, and no `model` or `stream` (the URL carries both) and none of the Anthropic API fields Bedrock does not have (`metadata`, `service_tier`, `container`, `mcp_servers`). Every other id, and an application inference profile (its id is opaque), goes over `bedrock.converse`: `POST /model/<id>/converse` or `/converse-stream`. An explicit `api` wins: `api: "converse"` sends a Claude model through Converse, and `api: "anthropic.messages"` on an application inference profile of a Claude model keeps it on InvokeModel. `api: "chat"` is rejected at detection (`unsupported_api`).
- Streaming. Bedrock streams `application/vnd.amazon.eventstream` frames, not SSE. `lib/eventstream.mjs` parses them (both CRCs are checked, frames may be split across chunks anywhere) and the result is read like an SSE stream: an InvokeModel `chunk` event carries base64 JSON of one Anthropic event (Bedrock's `amazon-bedrock-invocationMetrics` is removed), a ConverseStream event is named by its `:event-type`. An `exception` frame ends the stream with an `error` event or chunk (`throttlingException` is a 429 `rate_limit_error`, `validationException` a 400, `modelStreamErrorException` a 424, `serviceUnavailableException` a 503, `accessDeniedException` a 403, unknown ones a 500); so does a corrupt or cut-off stream.
- Tools over Converse. Converse needs a `toolConfig` whenever the history has tool calls or results, and has no "none" choice. A request with no tools has its past tool calls and results written as text; `tool_choice: "none"` with tools sends the `toolConfig` and adds a system instruction not to call tools.
- Converse mapping. See [protocol-support.md](protocol-support.md#11-amazon-bedrock-converse) for the table. The converters build on the Chat Completions ones (`convert/anthropic/messages/to/bedrock/converse`, `convert/openai/chat/to/bedrock/converse`, `convert/bedrock/converse/to/anthropic/messages` and `.../openai/chat`, helpers in `lib/converse.mjs`).
- Model list. `GET /models` is answered from the control plane: `GET /foundation-models` on `bedrock.<region>.amazonaws.com` (the runtime host with `bedrock-runtime` replaced by `bedrock`; a URL that is not a runtime host is asked itself), signed like every call. Models that do not output text are left out. Inference profiles are not listed, so name the ones you use in the upstream's `models`. When the call fails or there is no credential, the configured `models` are listed.
- Token counts. Bedrock has a `CountTokens` operation, but the driver does not use it ([#180](https://github.com/CLDMV/llm-translator/issues/180)): counts are the usual estimate of one token per four characters.
- `anthropic-beta` and other Anthropic request headers are not sent (Bedrock takes betas in the body as `anthropic_beta`, which is not set, [#180](https://github.com/CLDMV/llm-translator/issues/180)). `strict` tool use is not claimed for this driver.

Nothing here has been run against real AWS. The URLs, the double-encoded canonical path, the event stream framing and the Converse shapes come from the AWS documentation, and the SigV4 signer is checked against the published test-suite vectors; real-backend validation is tracked in [#70](https://github.com/CLDMV/llm-translator/issues/70). What is not mapped yet (prompt caching, signed reasoning round trip, structured output, the AWS credential chain, `anthropic_beta`, `CountTokens`) is tracked in [#180](https://github.com/CLDMV/llm-translator/issues/180).

## Cohere

The `cohere` driver is bound by host name (`api.cohere.com`, `api.cohere.ai`), with no request, or chosen with `backend: "cohere"`. It speaks two protocols: Chat Completions through Cohere's [Compatibility API](https://docs.cohere.com/docs/compatibility-api), and Cohere's own v2 chat API (`cohere.chat`), which an upstream selects with `api: "cohere"`.

```js
createTranslator({
	front: "anthropic",
	upstreams: [{ url: "https://api.cohere.com", apiKey: process.env.COHERE_API_KEY, api: "cohere", models: ["command-a-03-2025"] }]
});
```

- Protocol. Under `api: "auto"` a request goes over Chat Completions, unless it needs something only Cohere's own protocol has (a thinking budget or an effort other than `none` and `high`, a tool choice, `parallel_tool_calls: false`, structured output next to tools, `logprobs`, one of Cohere's own fields, or a `document` or `search_result` block that asks for citations), when it goes over `cohere.chat`: `POST /compatibility/v1/chat/completions` (an upstream URL that already ends in `/compatibility` or `/compatibility/v1` is not doubled). With `api: "cohere"` the request goes to `POST /v2/chat`, converted from either front. Embeddings always use the Compatibility API. The key is sent as `Authorization: Bearer`.
- Several choices. The Compatibility API has no `n`; `info().n: false` makes the translator answer `n` above 1 with parallel requests.
- Compatibility API. The driver removes the fields the page lists as unsupported (`store`, `metadata`, `logit_bias`, `top_logprobs`, `n`, `modalities`, `prediction`, `audio`, `service_tier`, `parallel_tool_calls`) and `stream_options`, records each in `state.dropped`, and maps `reasoning_effort` to the two values it takes: `none` stays and every other level is sent as `high`. Its settings are `max_tokens`, `thinking: "reasoning_effort"` (disabled thinking is `none`, enabled is `high`), no `top_k`, no usage chunk asked for.
- Native mapping. See [protocol-support.md](protocol-support.md#13-cohere-v2-chat) for the table. The converters build on the Chat Completions ones (`convert/anthropic/messages/to/cohere/chat`, `convert/openai/chat/to/cohere/chat`, `convert/cohere/chat/to/anthropic/messages` and `.../openai/chat`, helpers in `lib/cohere.mjs`). Citations (those of the model's thinking are `[n]` markers in the thinking text with a source list after it, taken out again when the thinking is sent back), documents, tool plans, log probabilities, effort budgets and the clamping of values are in that table. The upstream's `sampling` setting and an Anthropic request's `metadata.sampling` are Cohere's own top-level fields (`safety_mode`, `citation_options`, `priority`, `strict_tools`, ...) and are sent as given; fields the request names win.
- Model list. `GET /v1/models?endpoint=chat` (page size 1000, following `next_page_token`, at most 20 pages), mapped to `id` and, when Cohere gives it, `context_length`. A failed first page falls back to the configured `models`; a failed later page keeps what was read.
- Token counts. `POST /v1/tokenize` with the model: it takes one raw string, so the text the model reads (messages, reasoning, tool plans, tool calls, tool definitions, documents) is sent in pieces of at most 65,536 characters and the counts are added. That is the tokenizer's count of the text, without the few tokens of chat template around each message, so it is a little below what the chat endpoint bills and much closer than the estimate of one token per four characters. A prompt that needs more than 16 calls, or a failed call, falls back to the estimate.
- Errors. Cohere's error body (`{ "message": "..." }`) is read like any other, and the HTTP status is the client's status. A reply that ends with `finish_reason` `ERROR` is a 502 and `TIMEOUT` a 504, in a stream an `error` event (Anthropic) or an error chunk plus `[DONE]` (OpenAI).

Nothing here has been run against the real API. The shapes come from the Cohere documentation for [chat](https://docs.cohere.com/reference/chat), [streaming](https://docs.cohere.com/reference/chat-stream), [reasoning](https://docs.cohere.com/docs/reasoning), [tool use](https://docs.cohere.com/docs/tool-use-overview), [list models](https://docs.cohere.com/reference/list-models) and the [Compatibility API](https://docs.cohere.com/docs/compatibility-api). What is not mapped is in [known-limitations.md](known-limitations.md#cohere).

## OpenRouter

What the `openrouter` driver changes compared with the generic one:

- Bound by host name `openrouter.ai`. The API lives under `/api`, so the driver's `path` leaf puts `/api` in front of the usual `/v1/...` paths unless the upstream URL already ends in it. `https://openrouter.ai`, `https://openrouter.ai/api` and `https://openrouter.ai/api/v1` (the config removes the `/v1`) all reach `https://openrouter.ai/api/v1/chat/completions`.
- `reasoningRoundTrip` is on. OpenRouter wants the `reasoning_details` of the previous turn back unmodified and in order, which matters most when tools are involved. The items (`reasoning.text` with an optional `signature`, `reasoning.summary`, `reasoning.encrypted`, each with `id`, `format` and `index`) ride in the thinking block's `llmt:` signature and are put back on the assistant message in the order they arrived, next to the `reasoning` text. Streamed fragments of one item (same `index` and `type`) are merged into one item. An OpenAI client talking to OpenRouter gets the replies and sends its history through as it is.
- Reasoning controls are sent as OpenRouter's `reasoning` object, never both `effort` and `max_tokens`. `output_config.effort` (or the `reasoning_effort` of an OpenAI client) becomes `reasoning: { effort }`, thinking `enabled` with no effort becomes `medium`, and `thinking: { type: "disabled" }` becomes `reasoning: { effort: "none" }`. Thinking `enabled` with a `budget_tokens` and no effort becomes `reasoning: { max_tokens }`, capped at one below the request's `max_tokens`. A `reasoning` object the client sends itself (OpenAI front) is kept as it is, so `exclude` and `enabled` are available there. The `efforts` and alias pins apply to the effort as for any OpenAI-protocol upstream.
- Errors inside a successful reply. OpenRouter can answer HTTP 200 with `choices[i].error` (`{ code, message, metadata }`, `finish_reason: "error"`) when the provider fails while generating, or with a top-level `error` and no choices. When every choice carries an error (or there are no choices and the reply has an `error`), the reply becomes an upstream error: its status is the error's numeric `code` when that is 400 to 599 (else 502), its code is `metadata.error_type`, and the message names `metadata.provider_name`. Partial text of the failed choice is dropped. In a stream, an error chunk (a top-level `error` with `finish_reason: "error"`) ends an Anthropic-front stream with an `error` event, and an error found only on a choice is moved to the top level first so it ends the stream the same way; an OpenAI-front stream is forwarded as OpenRouter sent it, apart from that same move of a choice error to the top level.
- Comment lines (`: OPENROUTER PROCESSING`) are skipped by the SSE parser. The last chunk before `[DONE]` carries `usage` together with one choice with an empty delta that repeats the `finish_reason`; it is read as usage only and produces no second stop.
- `reasoningField: "reasoning"`, `maxTokensField: "max_tokens"`, `topK: true`, `prefill: "none"` (a trailing assistant message is OpenRouter's own prefill), `streamUsage: true`.

Nothing here has been run against the real API: the field names and shapes are from the OpenRouter documentation on [reasoning tokens](https://openrouter.ai/docs/use-cases/reasoning-tokens), [errors](https://openrouter.ai/docs/api-reference/errors) and [streaming](https://openrouter.ai/docs/api-reference/streaming), and real-backend validation is tracked in [#70](https://github.com/CLDMV/llm-translator/issues/70). Provider routing options (`provider`, `models`, `route`), OpenRouter's usage `cost` field and its app attribution headers are not special-cased; they can be set through `headers` on the upstream and, for the request fields, the OpenAI front.

## Hosted OpenAI-compatible providers (Groq, Together, Fireworks, xAI, Gemini)

Five hosted APIs that speak Chat Completions each have a driver: `groq`, `together`, `fireworks`, `xai` and `gemini`. Each is bound by host name with no request, or chosen by name with the upstream's `backend` (`backend: "groq"`, which also works for a proxy or gateway in front of the provider). The upstream's `url` is the provider's host; the path root is added for you, so `https://api.groq.com`, `https://api.groq.com/openai` and `https://api.groq.com/openai/v1` reach the same URL.

The drivers are thin: their folders hold one-line leaves, and the facts live in one table, `PRESETS` in `src/lib/presets.mjs` (host names, path root, settings, the request fields the provider rejects). Adding another provider is one table entry and a folder of those leaves. Choosing the driver by `backend` name rather than a separate `preset` field means there is one way to pick a provider, the same as for every other driver, and `settings` on the upstream still overrides any of the values below.

| Preset      | Base URL                                                  | Token field             | Reasoning field                     | Thinking and effort                                                                            | `top_k` | Stream usage                                       | Drops                                                                                                                              |
| ----------- | --------------------------------------------------------- | ----------------------- | ----------------------------------- | ---------------------------------------------------------------------------------------------- | ------- | -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `groq`      | `https://api.groq.com/openai/v1`                          | `max_completion_tokens` | `reasoning`                         | effort only when the request names one                                                         | no      | `stream_options`                                   | `logprobs`, `top_logprobs`, `logit_bias`, `name` on messages                                                                       |
| `together`  | `https://api.together.ai/v1`                              | `max_tokens`            | `reasoning` (round trip on)         | effort only when the request names one                                                         | yes     | no `stream_options`; usage is read from the chunks | none; no `parallel_tool_calls` is sent                                                                                             |
| `fireworks` | `https://api.fireworks.ai/inference/v1`                   | `max_tokens`            | `reasoning_content` (round trip on) | `reasoning_effort`: disabled thinking is `none`, enabled is `medium` unless an effort is given | yes     | `stream_options`                                   | none                                                                                                                               |
| `xai`       | `https://api.x.ai/v1`                                     | `max_completion_tokens` | `reasoning_content`                 | effort only when the request names one                                                         | no      | `stream_options`                                   | `stop`, `presence_penalty`, `frequency_penalty` on reasoning models (`grok-3-mini`, `grok-4*`, `grok-code*`, not `*non-reasoning`) |
| `gemini`    | `https://generativelanguage.googleapis.com/v1beta/openai` | `max_tokens`            | default                             | effort only when the request names one                                                         | no      | `stream_options`                                   | none                                                                                                                               |

Notes that apply to all five:

- `prefill: "none"` (no `continue_final_message`), `images` and `responseFormat` stay on, and `thinkingBudget` is off. `thinking: "none"` means enabled or disabled thinking sends no switch: the reasoning models of Groq, Together, xAI and Gemini take different effort values (Groq's `gpt-oss` models reject `none`, xAI's models cannot switch reasoning off, Gemini 2.5 Pro and the 3 and 4 series cannot either), so only an effort the request names (`output_config.effort`, or `reasoning_effort` from an OpenAI client) is sent. List the levels a model takes under `efforts` to have the effort snapped to them.
- `together` and `fireworks` list `top_k`, `min_p` and `repetition_penalty` in `info().fields`, so they pass through the OpenAI front's `passthroughFilter`.
- The `groq` driver removes the fields Groq answers with a 400; `n` is left alone and Groq answers its own error for a value above 1. Groq's `reasoning_format` and `include_reasoning` are not set; a model that returns `<think>` in the content is parsed by `thinkTags`.
- Embeddings and the model list use the same root (Gemini's is `/v1beta/openai/embeddings` and `/v1beta/openai/models`).

What the settings are based on: Groq's [OpenAI compatibility](https://console.groq.com/docs/openai) and [reasoning](https://console.groq.com/docs/reasoning) pages and its API reference (`max_tokens` deprecated for `max_completion_tokens`, the unsupported fields, `message.reasoning`); Together's [OpenAI compatibility](https://docs.together.ai/docs/openai-api-compatibility) page and chat completions reference (`max_tokens`, `top_k`, `min_p`, `repetition_penalty`, no `stream_options` or `parallel_tool_calls`, reasoning under `reasoning` or `reasoning_content` and passed back under the same key); Fireworks' [OpenAI compatibility](https://docs.fireworks.ai/tools-sdks/openai-compatibility), [reasoning](https://docs.fireworks.ai/guides/reasoning) and chat completions reference (`/inference/v1`, `reasoning_content`, `reasoning_effort`, usage chunk by default); xAI's [reasoning guide](https://docs.x.ai/docs/guides/reasoning) and API reference (chat completions is a legacy endpoint there; `max_tokens` deprecated; reasoning cannot be disabled; `stop` and the penalties rejected on reasoning models); and Google's [OpenAI compatibility](https://ai.google.dev/gemini-api/docs/openai) page (`/v1beta/openai`, `reasoning_effort` mapping, `stream_options`). Nothing here has been run against the real APIs. Two values are not stated on those pages and are best guesses: Gemini's `max_tokens` (the page names neither field) and xAI's `reasoning_content` field name in Chat Completions (the page only shows it in SDK output). Together's lack of `stream_options` follows its request schema; set `streamUsage: true` on the upstream if your account accepts it. Real-backend validation is tracked in [#70](https://github.com/CLDMV/llm-translator/issues/70).

### Gemini native API

The `gemini` driver speaks Google's OpenAI-compatible endpoint by default (above). With `api: "gemini"` (or `"google"`, or `"google.gemini"`) an upstream goes over Google's own `generateContent` API instead, for both fronts. Nothing else changes: the upstream is still bound by the host name `generativelanguage.googleapis.com`, or by `backend: "gemini"` for a proxy or a local stand-in.

```js
createTranslator({
	front: "anthropic",
	upstreams: [{ url: "https://generativelanguage.googleapis.com", backend: "gemini", api: "gemini", apiKey: process.env.GEMINI_API_KEY }]
});
```

- Calls. `POST /v1beta/models/<model>:generateContent`, or `:streamGenerateContent?alt=sse` for a stream (SSE; each event is a whole `GenerateContentResponse`). The model id goes in the URL (a `models/` prefix is accepted and not doubled), so the body has neither `model` nor `stream`. A `url` that ends in `/v1beta` is fine; one that ends in `/v1beta/openai` is the compatibility endpoint's root and is not rewritten.
- Key. The upstream's `apiKey` is sent as `x-goog-api-key`, which is what the native API takes; the compatibility endpoint keeps its bearer header. Headers set in the upstream's `headers` are sent as given.
- Documents and files. A base64 PDF in an Anthropic `document` block, a PDF at a URL (`url` source), and an OpenAI-front `file` part are sent as `inlineData` or `fileData` `application/pdf` and read by Gemini itself, instead of the extraction into text and page images other upstreams get. With `documents` set to `note` or `error`, `images` off, or a `documentConverter` on the upstream, the usual handling applies; documents that are not PDFs are always expanded as usual.
- Images and files. Base64 PNG, JPEG, WebP, HEIC and HEIF images are sent as `inlineData`. A GIF (which Gemini does not read) is decoded and sent as a PNG of its first frame, with `@napi-rs/canvas`. An image, a PDF or another file at an `http(s)` URL (a public one, a signed one, a Files API URI, a YouTube URL) or a Cloud Storage `gs://` URI is sent as a `fileData` reference, with the type its extension names (an image URL with none is taken for `image/jpeg`); Google reads it, up to its own limits (15 MB for an external URL). A GIF at a URL cannot be given to Gemini, so it is fetched by the translator and sent as a PNG, only when the `documentUrls` setting is on (its allow list and limits apply, nothing else is fetched); without it the image becomes a text note. `input_audio` parts are sent as `inlineData` audio.
- Output. Generated images (`inlineData` image parts) are `message.images` on the OpenAI front (`{ type: "image_url", image_url: { url: "data:..." } }`) and markdown images in the text on the Anthropic front. An `image` model id (`...-image...`) asks for `TEXT` and `IMAGE` output, `modalities: ["text", "image"]` and `["text", "audio"]` ask for them, and audio output (`audio: { voice, format }`, the voice being a Gemini voice name such as `Kore`) returns Gemini's raw 16-bit PCM as `message.audio` in `wav` (a WAV header added), `pcm16`, `mp3`, `opus` (Ogg Opus) or `flac`; another format is refused with `invalid_request`. The three encoded formats need optional packages, loaded when a request asks for the format: `wasm-media-encoders` (MP3, MIT), `opusscript` (Opus, MIT, with an Ogg writer in `lib/gemini-audio.mjs`; 8, 12, 16, 24 or 48 kHz audio, which covers Gemini's 24 kHz) and `libflacjs` (FLAC, MIT, its asm.js build, because its WebAssembly build failed to start on Node 26 when tried). Without the package the request fails before it is sent with `audio_encoder_unavailable` (501) naming it, and `wav` and `pcm16` keep working. Code Gemini ran (`executableCode`) and its output (`codeExecutionResult`) are fenced blocks in the text. `logprobs` and `top_logprobs` are `responseLogprobs` and `logprobs`, and the log probabilities come back on the OpenAI front.
- Tools. Each tool's JSON Schema is rewritten into what Gemini takes (`lib/gemini-schema.mjs`): `type`, `properties`, `required`, `items`, `prefixItems`, `enum`, `anyOf`, `minimum`, `maximum`, `minItems`, `maxItems`, `additionalProperties`, `format` (`date-time`, `date`, `time`), `title` and `description` are kept; `oneOf` becomes `anyOf`, `const` a one-value `enum`, `nullable` a `"null"` type, `allOf` is merged, a local `$ref` is replaced by its target (a recursive one is expanded once); everything else (`pattern`, `default`, `$schema`, `exclusiveMinimum`, ...) is removed. `tool_choice` `auto`, `required`, `none` and a named function map as before, and an OpenAI `allowed_tools` choice is `ANY` with `allowedFunctionNames` for its `required` mode and, for `auto`, `AUTO` over only the tools it lists. Gemini has no switch against parallel calls, so `parallel_tool_calls: false` (and Anthropic's `disable_parallel_tool_use`) keeps only the first function call of a reply; the model asks for the others again on the next turn. Anthropic server tools become built-in tools: `web_search_*` is Google Search (`googleSearch`), `web_fetch_*` is URL context (`urlContext`) and `code_execution_*` is code execution (`codeExecution`). Other built-in tools (Google Maps, computer use, file search, anything Google adds) are named in `settings.gemini.tools`, which are added to every request, for example `{ computerUse: { environment: "ENVIRONMENT_BROWSER" } }`; a computer-use call comes back as an ordinary tool call.
- The `gemini` setting. Set on the upstream (`settings: { gemini: { ... } }`, or in the global `settings`), never by a client: `safetySettings` (sent as given), `tools` (above), `cachedContent` (a name such as `cachedContents/abc` sent with every request; the system instruction, tools and tool config it holds are left out of the request), `cache` (false stops `cache_control` from creating cached contents), `thinking` (above), `responseModalities`, `imageConfig`, `speechConfig` and `mediaResolution` (sent in `generationConfig`). Each key is checked when the settings are resolved. See [settings.md](settings.md).
- Cached contents. An Anthropic `cache_control` breakpoint makes the conversation up to its last occurrence a cached content, which is what Gemini offers in place of Anthropic's prompt cache. The request up to the breakpoint (every tool and system block, a breakpoint in either counting as one after both; the messages up to the block, rounded down to a whole message) is created with `POST /v1beta/cachedContents` (`.../locations/<region>/cachedContents` on Vertex AI) for `ttl` of 5 minutes or an hour (`cache_control.ttl`, default 5 minutes), and the request that follows carries `cachedContent` and only what comes after the breakpoint. The cache is remembered for the upstream until it is about to expire, so the next turn only reads it (the tokens it serves are `cache_read_input_tokens`; the request that creates it reports the tokens written, as Google's create call counts them in `usageMetadata.totalTokenCount`, as `cache_creation_input_tokens`, and none as read, and the OpenAI front's usage has them as `prompt_tokens_details.cache_write_tokens`, the name OpenRouter uses). A prefix shorter than about 4000 characters is not worth a call and goes whole, and one Google refuses (too small for the model, no permission) goes whole too, with a `cache` warning, and is not tried again for ten minutes. A token count always sends the whole prompt. `settings.gemini.cache: false` turns it off, and so does `settings.gemini.cachedContent`.
- Candidates. `n` up to 8 is `candidateCount` in one request, and a stream carries every candidate with its own `index`; above 8 the translator's fan-out sends one request per choice.
- Finish reasons. A reply that stops for a reason other than a normal end, a length cut-off or a filter (`MALFORMED_FUNCTION_CALL`, `OTHER`, `MISSING_THOUGHT_SIGNATURE`, a reason Google adds later) is not a failure: it ends the turn (`end_turn` / `stop`, or `tool_use` / `tool_calls` when the reply called tools) with what it has and a note at the end of the text, `[Gemini ended the reply early (REASON): finishMessage]`.
- Mapping. See [protocol-support.md](protocol-support.md#12-google-gemini-generatecontent) for the table. The converters build on the Chat Completions ones (`convert/anthropic/messages/to/google/gemini`, `convert/openai/chat/to/google/gemini`, `convert/google/gemini/to/anthropic/messages` and `.../openai/chat`), and the body building and reply parsing is in `lib/gemini.mjs`, written so a later Vertex AI Gemini upstream can reuse it.
- Thinking. `thinking: { type: "enabled", budget_tokens }` is `thinkingConfig.thinkingBudget` with `includeThoughts: true`, and `thinking: { type: "adaptive" }` (or `reasoning_effort: "dynamic"`) asks for the model to decide (a budget of -1; on a Gemini 3 model, no control at all, which is its own default). An effort (`output_config.effort`, `reasoning_effort`) is sent as a budget too (`minimal` 512, `low` 1024, `medium` 8192, `high`, `xhigh` and `max` 24576, the largest budget every 2.5 model takes), and `thinking: { type: "disabled" }` or effort `none` is a budget of 0. A budget is kept inside the range of its 2.5 family: Pro takes 128 to 32768 and cannot be switched off (a request for less is raised to 128), Flash-Lite thinks in at least 512 tokens, Flash takes 0 to 24576. Gemini 3 and later models take `thinkingLevel` instead, and Google refuses or deprecates a budget for them: the effort, or the closest effort for a budget, becomes `MINIMAL`, `LOW`, `MEDIUM`, `HIGH` or `XHIGH`, moved to the nearest level the model has (`gemini-3-pro` has `LOW` and `HIGH` only, other Pro models have no `MINIMAL`, Gemini 4 has no `MINIMAL` and adds `XHIGH`), and `none` is the lowest level with no thought summaries, because these models cannot switch thinking off. Which kind a model takes is decided from its id as sent upstream, after aliases: `gemini-<N>[.<M>]-...` with N of 3 or more takes levels and a 2.5 id takes a budget. For any other id (a tuned model, a new naming) set `settings.gemini.thinking` to `"level"` or `"budget"`.
- Thought signatures. Gemini 3 models refuse a tool turn whose `functionCall` part lacks its `thoughtSignature`, so the native protocol always carries them (it turns `reasoningRoundTrip` on for the upstream, as the Responses API does). A reply's signatures travel in `reasoning_details` items of format `google-gemini-v1` (`data` is the signature, `for` is `text`, `thought` or `call`; a call has the tool call `id`, and text and thought have `rest`, the number of characters of that text that follow the signed part, so the signature goes back on the part it came from even when the client trims the start of the text); an Anthropic client gets them in its thinking block's `llmt:` signature (see D-46 in [decisions.md](decisions.md)) and an OpenAI client replays the items. A signed thought part is sent back as a thought part, a signature on a part with no text is sent back on an empty part, and thought text with no signature is not sent. In a stream the signatures of text and thought come at the end of the candidate, when the length of the text is known. The first function call of a model turn that has no signature (a client that drops its thinking blocks, or history written by another model) is sent with Google's documented placeholder `skip_thought_signature_validator`, which Gemini 3 models accept in place of a real one; Google describes it as a last resort that can lower answer quality, and Gemini 2.5 models treat signatures as optional. Later calls of the turn are sent as they are.
- Model list. `GET /v1beta/models` (every page, up to 20), keeping the models that list `generateContent`, with the `models/` prefix removed and `inputTokenLimit` as `max_model_len`. An upstream on the compatibility endpoint lists its configured models as before.
- Token counts. `POST /v1beta/models/<model>:countTokens` with the prompt as a `generateContentRequest`; when it fails the estimate of one token per four characters is used. An upstream on the compatibility endpoint always estimates.
- Errors. Google's `{ error: { code, message, status } }` (also inside a one-element array) is normalized, and the `status` (`INVALID_ARGUMENT`) is the error code the client sees.

Nothing here has been run against real Google services: the URLs and field names come from Google's API reference, and the tests use a local stand-in. What is not mapped is in [known-limitations.md](known-limitations.md#google-gemini-native-api).

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

## Ollama (`/v1`, and the native `/api/chat` mode)

What the `ollama` driver changes compared with the generic one:

- `tool_choice`, `n` and `logit_bias` are removed (Ollama's `/v1` does not implement them) and recorded in `state.dropped`. `top_k` and `parallel_tool_calls` are not sent, and `max_tokens` is the output cap field.
- Images given by URL are replaced by a short text note and recorded as a drop (`image_url`): `/v1` takes base64 data URLs only, and the translator does not fetch URLs on a client's behalf (the same rule as for documents by URL). Base64 images, which is what Claude Code sends, pass through.
- Ollama truncates prompts that exceed `num_ctx` without any error, and the default is small. The driver sets `contextWindow: 4096` and prints one warning per upstream the first time a request is estimated (four characters per token) to exceed it. Raise the real limit on the server (`OLLAMA_CONTEXT_LENGTH` or a Modelfile `num_ctx`) and set the upstream's `contextWindow` to match; `0` turns the warning off. See [decision D-42](decisions.md).

### Native `/api/chat` mode

An upstream with `api: "ollama.chat"` (the aliases `"native"` and `"ollama"` mean the same; `backend: "ollama"`, or detected) talks to Ollama's own chat API instead of `/v1`. It is never chosen by `"auto"`: the native mode is opt-in per upstream because it needs Ollama behaviour that `/v1` hides (the `think` control, `options`, `format`). Chat goes to `POST /api/chat`, and the model list and embeddings still use `/v1/models` and `/v1/embeddings`. Setting it on an upstream whose driver does not list `ollama.chat` (any driver but `ollama`) fails at detection with `unsupported_api`.

The converters sit beside the others: `convert/anthropic/messages/to/ollama/chat` and `convert/openai/chat/to/ollama/chat` for the request, `convert/ollama/chat/to/anthropic/messages` and `convert/ollama/chat/to/openai/chat` for the reply and the stream (see [protocol-support.md](protocol-support.md#7-ollama-native-apichat)). They build on the Chat Completions converters and the shared helpers in `lib/ollama.mjs` and `lib/ndjson.mjs`:

- Tool arguments are JSON objects on the wire. A tool result names its tool (`tool_name`, found from the call id of the earlier assistant turn). Ollama sends no tool-call ids, so each call in a reply gets a `call_` id when it is converted, once per call (a streamed call arrives whole, so its id never changes between chunks); an id the server did send is kept.
- Thinking is `message.thinking` in replies, streamed before the answer, and goes back the same way on assistant turns. The request's `think` is the effort when there is one (`none` is `false`; `minimal` and `low` are `"low"`, `xhigh` is `"high"`, `max` is `"max"`; a level the model does not take falls back to its default on Ollama's side), else the thinking switch (enabled `true`, disabled `false`). An OpenAI client may also send `think` itself, as a boolean or a level.
- `max_tokens` is `options.num_predict`; `temperature`, `top_p`, `top_k`, `min_p`, `seed`, `frequency_penalty` and `presence_penalty` are options of the same name; `stop` is `options.stop` (always a list) and `repetition_penalty` is `options.repeat_penalty`. The upstream's `sampling` setting and an Anthropic request's `metadata.sampling` add more options (any Modelfile parameter such as `num_ctx` or `mirostat`), under what the request names itself; an OpenAI client's own `options` object has the last word. A request that sets `options.num_ctx` replaces `contextWindow` for the truncation warning.
- `response_format` (OpenAI) and `output_config.format` (Anthropic) become `format`: `"json"` for `json_object`, the schema for `json_schema`. An OpenAI client's own `format` and `keep_alive` are sent as they are.
- Images are base64 strings in `images`; an image given by URL is replaced by a note, as in `/v1` mode. Anthropic `document` blocks follow the usual `documents` setting.
- `done_reason` becomes the finish reason (`length` stays `length`, a reply with tool calls ends with `tool_calls`, anything else is `stop`) and `prompt_eval_count` and `eval_count` become the usage. A reply, or a streamed line, carrying `error` is an upstream error (a stream ends with an error event or an error chunk).
- Left out and recorded in `state.dropped`: `tool_choice` other than `auto` (`none` also removes the tools), `n` above 1, `logit_bias`, `logprobs` and any other field Ollama has no equivalent for. Ollama's native stream has no usage option, so `streamUsage`, `maxTokensField`, `thinking`, `effort`, `topK`, `prefill`, `parallelToolCalls` and `reasoningRoundTrip` do not apply in this mode, and neither do `efforts` levels, the image and tool fallbacks (they react to `/v1` error wording) and `passthroughFilter`.
- The stream is newline-delimited JSON, not SSE. `lib/ndjson.mjs` buffers a partial last line across chunks, so a line split at any byte (also inside a multi-byte character) is parsed once it is complete; a line that is not JSON ends the stream with an error.

Nothing here has been run against a real Ollama server yet; the field names come from Ollama's [API reference](https://docs.ollama.com/api/chat) and the [thinking](https://docs.ollama.com/capabilities/thinking), [tool calling](https://docs.ollama.com/capabilities/tool-calling) and [structured outputs](https://docs.ollama.com/capabilities/structured-outputs) pages, and real-backend validation is tracked in [#70](https://github.com/CLDMV/llm-translator/issues/70). Not covered by those pages and not special-cased: how a streamed reply splits thinking and tool calls across lines (the converter accepts them in any line), and `logprobs`.

Nothing in `/v1` mode has been run against a real Ollama server yet; in particular the wording Ollama uses to refuse images on a text-only model is not in the `imageFallback` list (tracked in [#70](https://github.com/CLDMV/llm-translator/issues/70)).

## Choosing the protocol (`api`)

Each upstream has one `api` setting that picks the protocol the translator speaks to it. The default is `"auto"`.

```js
createTranslator({
	front: "anthropic",
	upstreams: [
		{ url: "http://gpu-box:8000", backend: "vllm" },
		{ url: "http://box:11434", backend: "ollama", api: "ollama.chat" }
	]
});
```

| Canonical id         | Also accepted                     | Speaks to                                                                                                                                                                                                                              |
| -------------------- | --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `auto` (default)     |                                   | The client's own protocol when the driver's server speaks it, Chat Completions otherwise, with a fall back (see below).                                                                                                                |
| `anthropic.messages` | `messages`, `anthropic`, `claude` | `POST /v1/messages`.                                                                                                                                                                                                                   |
| `openai.chat`        | `chat`, `openai`, `chatgpt`       | `POST /v1/chat/completions`.                                                                                                                                                                                                           |
| `openai.responses`   | `responses`, `codex`              | `POST /v1/responses`.                                                                                                                                                                                                                  |
| `ollama.chat`        | `native`, `ollama`                | Ollama's own `POST /api/chat`, see [Native `/api/chat` mode](#native-apichat-mode).                                                                                                                                                    |
| `bedrock.converse`   | `converse`                        | Amazon Bedrock's `POST /model/<id>/converse`, see [Amazon Bedrock](#amazon-bedrock).                                                                                                                                                   |
| `google.gemini`      | `gemini`, `google`                | Google's `POST /v1beta/models/<model>:generateContent` (on the Gemini API host) or the Google publisher's `generateContent` on Vertex AI, see [Gemini native API](#gemini-native-api) and [Gemini on Vertex AI](#gemini-on-vertex-ai). |
| `cohere.chat`        | `cohere`                          | Cohere's own `POST /v2/chat`, see [Cohere](#cohere).                                                                                                                                                                                   |

Names are not case sensitive, and `status()` reports the canonical id. Any other value fails config validation and lists the accepted ones. Each driver declares the protocols its server speaks in `info().protocols` (the Speaks column in the table at the top), and an explicit `api` the driver does not list fails detection with `unsupported_api` and names the drivers that do.

With `api: "auto"` the protocol is chosen per request, from the protocol the client used:

- An Anthropic client (`/v1/messages` on the Anthropic front) goes to `/v1/messages` when the server has it: the Anthropic driver, and vLLM 0.11.1 and later (known from detection or the upstream's `version`; an unknown version stays on Chat Completions, see [Native `/v1/messages` for vLLM](#native-v1messages-for-vllm)). Every other server gets Chat Completions.
- A Chat Completions client (`/v1/chat/completions`) goes over Chat Completions, or over `/v1/messages` to the Anthropic driver, converted.
- A Responses client (`/v1/responses` on the OpenAI front) goes to the server's Responses API when the driver lists it, and over Chat Completions otherwise.

Google's native Gemini API is not part of `auto` at all: no client speaks it, so an upstream uses it only with an explicit `api: "gemini"`, and `auto` keeps the OpenAI-compatible endpoint. Amazon Bedrock is the exception to these rules: its protocol follows the model id (Claude over `anthropic.messages`, everything else over `bedrock.converse`) for every client, and it never falls back. Cohere's own protocol is only used when named (`api: "cohere"`), like Ollama's.

So an Anthropic client to vLLM 0.11.1 or later uses `/v1/messages`, an OpenAI chat client to vLLM uses Chat Completions, a Responses client to OpenAI or vLLM uses the Responses API, an Anthropic client to Groq uses Chat Completions and an Anthropic client to the Anthropic driver uses Messages. A driver whose server speaks none of the client's protocols nor Chat Completions (the Anthropic driver, for an OpenAI client) gets its own protocol by conversion.

If the server answers 404, 405 or 501 to the protocol chosen (no such route, or not implemented), the same request is sent again over the next protocol (Chat Completions), a `fallback` event is emitted (`kind: "messages"` or `"responses"`), and the upstream stays off that protocol until the next detection, so later requests skip the first attempt. Each protocol is remembered on its own: a missing Responses API does not change what an Anthropic client gets. This works for streamed and non-streamed requests alike. A 404 from a Messages route only counts when it is FastAPI's `{"detail":"Not Found"}` (a missing route); an Anthropic-shaped error (an unknown model) is returned as it is, and so is any other error, a 400 or a 5xx for example, or a network failure.

An explicit `api` is always that protocol for every client, and never falls back: an upstream set to `"responses"` that answers 404 returns that error to the client. One exception follows from what vLLM's `/v1/messages` is: it takes an Anthropic client's body as it is, so with `api: "messages"` on vLLM a Chat Completions or Responses client still goes over Chat Completions, and an Anthropic request the route cannot take (see below) is converted for that request.

`status()` reports `api` (the setting), `protocols` (what the driver speaks) and `protocol`, the one a request in the configured front's protocol goes over right now. `responses` is true while a Responses client would reach the upstream's Responses API (OpenAI front only), and `messages` is true while an Anthropic client's request goes to vLLM's native `/v1/messages` (`null` for any other driver).

### Upgrading

The default was Chat Completions (`api: "openai"`). It is now `"auto"`, which still means Chat Completions for a Chat Completions client on every driver, but sends an Anthropic client to vLLM 0.11.1 and later over `/v1/messages` and a Responses client to a server that has the Responses API over `/v1/responses`. Set `api: "chat"` on an upstream to keep Chat Completions for every client. The `nativeMessages` setting is deprecated: it still works (`true` reads as `api: "messages"`, `"auto"` as `"auto"`, `false` as `api: "chat"`) with a one-time warning, and is ignored when `api` is set. `nativeMessages: false` used to leave a Responses client on Chat Completions only because the default did; it now maps to `api: "chat"`, which does the same.

## Responses API (`/v1/responses`)

An upstream can speak the Responses API instead of Chat Completions, chosen by `api` (see [Choosing the protocol](#choosing-the-protocol-api)). Both client protocols work: the request is converted to a Responses request body, and the reply or the SSE stream is converted back. Codex CLI uses the Responses API by default; it can be switched to Chat Completions with `wire_api = "chat"` in its provider config.

The bundled drivers that list `openai.responses` are `openai`, `compatible`, `vllm`, `ollama`, `lmstudio`, `llamacpp`, `sglang` and `localai`. The `compatible` driver is the way to opt any other server in, for example Azure OpenAI's v1 API (`url: "https://<resource>.openai.azure.com/openai/v1"`) or a hosted provider the translator has no driver for. A third-party driver lists `"openai.responses"` in `info().protocols` (the older `responses: true` is still read), or declares `protocol: "openai.responses"` to be Responses-only. The hosted drivers that build their own paths (`azure`, `groq`, `fireworks`, `openrouter`) do not list it.

What the conversion does:

- The system text before the first turn is `instructions`; later system messages are `system` input items. User, assistant and tool turns become message, `function_call` and `function_call_output` items, with the Chat tool-call id as `call_id`. Images and files become `input_image` and `input_file` parts.
- Requests are stateless: `store` is `false` and the whole conversation is sent on every call. `max_tokens` is `max_output_tokens`. Chat's `strict` tool flag defaults to off and the Responses API's to on, so `strict` is always written. `response_format` becomes `text.format`, and `reasoning_effort` becomes `reasoning.effort`.
- A request with a reasoning effort also asks for a reasoning summary (`reasoning.summary`, the `reasoningSummary` setting, `"auto"` by default, `"none"` to leave it out), which comes back as thinking text.
- Reasoning round trip: `reasoningRoundTrip` is on by default for a request that goes over this protocol (set it to `false` to turn it off); a request that goes over Chat Completions, after a fall back for example, does not get it. The request then asks for `include: ["reasoning.encrypted_content"]`, and each `reasoning` output item that carries `encrypted_content` travels as a `reasoning_details` item with `format: "openai-responses-v1"`. For an Anthropic client that data is signed into the thinking block's `llmt:` signature; the next request restores it and sends the `reasoning` item back before the tool call or message it led to. An OpenAI client gets the items in `reasoning_details` and replays them the same way. The signature is bound to the upstream's driver, protocol and host.
- Usage comes from `usage` (`input_tokens` includes the cached tokens, which are reported as cache reads), a reply with `status: "incomplete"` and `max_output_tokens` is a `length` stop, and a `failed` reply, a `response.failed` event or an `error` event is an upstream error (in a stream an `error` event for Anthropic clients, an error chunk and `[DONE]` for OpenAI clients).
- Fields the Responses API has no counterpart for (`stop`, `seed`, the penalties, `logit_bias`, `logprobs`, `top_k`) are dropped and recorded like any other dropped field, or refused when `unknownFields` is `"error"`. `n` above 1 is answered by parallel requests, as for Anthropic-protocol upstreams. The driver's own `request`, `response` and `chunk` leaves shape Chat Completions bodies and do not run for this protocol, and neither do the image and tool retries, the sampling and constraint extensions, `passthroughFilter` and the `efforts` level lists. Token counting uses the character estimate instead of the server's tokenizer.

See [protocol-support.md](protocol-support.md#9-responses-api-as-an-upstream) for the field table, and [known-limitations.md](known-limitations.md) for what is not covered. No bundled driver has been run against a real Responses server; the field and event names come from OpenAI's API reference.

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

### Native `/v1/messages` for vLLM

vLLM 0.11.1 and later serve the Anthropic Messages API themselves, and the translator uses it: with `api: "auto"` (the default) an Anthropic client's request is sent to `POST /v1/messages` as it is, instead of being converted to Chat Completions and back, when the detected `/version` (or the upstream's `version`) is 0.11.1 or later. An unknown version stays on conversion. `api: "messages"` uses the endpoint whatever the version, and `api: "chat"` never does. A Chat Completions or Responses client is not affected, and neither is any other driver. `status()` reports the state per upstream as `messages`. The deprecated `nativeMessages` setting maps onto `api` (see [Upgrading](#upgrading)).

vLLM's endpoint is itself a converter to Chat Completions inside the server, with gaps the translator fills:

- The system prompt arrives as one string, with the text blocks joined by a blank line and the billing header block removed (vLLM joins blocks with nothing between them).
- vLLM sends no `ping` event. A `ping` follows `message_start`, and the SSE writer still sends keep-alives while the stream is silent.
- vLLM before 0.17 sends thinking blocks without a `signature`. Such blocks get the translator's own marker signature (the same `llmt:` one the conversion makes); a signature vLLM made up is left alone.
- vLLM reads `tool_result.is_error` but ignores it. The marker text goes in front of the result (`toolErrors`, on by default), as it does in a conversion.
- The upstream is called with `Authorization: Bearer`, the only scheme vLLM checks. The client's `x-api-key` and `anthropic-beta` headers are not forwarded.

Some requests cannot go to the native endpoint and are converted as before: a request whose last message is from the assistant (the endpoint finishes that turn instead of continuing it), a request with `document` blocks (the endpoint rejects the block type; the conversion extracts the text and page images), and a request with deferred tools or `tool_reference` blocks unless `toolSearch` is `native`. The `metadata.sampling` extension is dropped, and a model's `efforts` list is not applied.

Under `api: "auto"`, an upstream that answers 404 to `/v1/messages` with a body that is not an Anthropic error (the route is missing) is converted for that request and for every later one, until the next `detect()`; a `fallback` event of kind `messages` is emitted once. A 404 in Anthropic error shape (an unknown model) is returned as an error and does not change the mode. An explicit `api: "messages"` never falls back. Token counting (`token.count`) never uses the endpoint: vLLM's tokenizer reads Chat Completions messages, so a count goes through the conversion.

### Readiness and LoRA adapters for vLLM

When a model is served by more than one vLLM endpoint, `send` asks each of them `GET /health` before it orders the pool, and skips the ones that say they are not ready while another serves the model. The mechanism is the shared pool health (`pool.healthInterval`, `pool.healthTimeout`, see [server.md](server.md#endpoint-pools-failover-and-load-balancing)); the vLLM driver switches it on by naming `/health` in `info().paths.health`, and other drivers can do the same. vLLM's `/load` is not used: it reports a server-side request counter (`server_load`) and answers 200 whatever the engine's state, so it says nothing about readiness.

vLLM lists each LoRA adapter (`--lora-modules`, or `/v1/load_lora_adapter` when `VLLM_ALLOW_RUNTIME_LORA_UPDATING` is on) in `/v1/models` as a model whose `parent` is the base model. Detection keeps them apart in the facts (`facts.adapters`, as `{ id, parent }`, next to `facts.models`, which lists both), so an adapter is routable like any model, and an upstream with one base model and some adapters is still the single model that unknown names fall back to. `model.list()` and `GET /v1/models` carry the `parent` field on an adapter's entry, on the Anthropic and the OpenAI front alike, and on an alias of an adapter. A list that is fetched live also updates what the upstream serves, so adapters loaded or unloaded at runtime start or stop being routable as soon as a client lists the models (or `detect()` runs); an upstream with a configured `models` list keeps that list.

## Constrained decoding (grammar, regex, choice, JSON Schema)

`output_config.format` and `response_format` only ever carry a JSON Schema. Backends that decode under a constraint also take a regular expression, a fixed list of choices or a grammar, each in a field of its own. A neutral `constraint` object describes one of them, and the driver of the upstream turns it into the backend's native field. It follows the same pattern as the `sampling` extension fields: set it per upstream (or globally) in the `constraint` setting, and a client can override it per request.

```json
{ "json": { "type": "object", "properties": { "ok": { "type": "boolean" } } } }
{ "regex": "[A-Z]{3}-[0-9]{4}" }
{ "choice": ["positive", "negative", "neutral"] }
{ "grammar": "root ::= \"yes\" | \"no\"" }
```

Exactly one of `json` (a JSON Schema object), `regex`, `choice` (a non-empty list of strings) and `grammar` is allowed. A client sends it as `constraint` on the OpenAI front or as `metadata.constraint` on the Anthropic front; either replaces the upstream's `constraint` setting, and neither is ever forwarded under that name. A malformed value in the request is a 400 `invalid_request`; in the setting it is `invalid_setting`. A body that already carries the backend's native field (`structured_outputs`, `regex`, `grammar`, `response_format` and so on) keeps it.

| Backend                                              | `json`                                     | `regex`                                     | `choice`                                 | `grammar`                         |
| ---------------------------------------------------- | ------------------------------------------ | ------------------------------------------- | ---------------------------------------- | --------------------------------- |
| vLLM 0.11.0 and later, unknown version, `compatible` | `structured_outputs: { json }`             | `structured_outputs: { regex }`             | `structured_outputs: { choice }`         | `structured_outputs: { grammar }` |
| vLLM before 0.11.0                                   | `guided_json`                              | `guided_regex`                              | `guided_choice`                          | `guided_grammar`                  |
| SGLang                                               | `response_format` `json_schema`            | `regex`                                     | `regex`, the choices escaped and joined  | `ebnf`                            |
| llama.cpp                                            | `json_schema`                              | not supported                               | `grammar`, a GBNF rule listing them      | `grammar` (GBNF)                  |
| TGI                                                  | `response_format: { type: "json", value }` | `response_format: { type: "regex", value }` | `response_format` `regex`, as for SGLang | not supported                     |
| any other OpenAI-protocol upstream                   | `response_format` `json_schema`            | not supported                               | not supported                            | not supported                     |

A kind the backend cannot enforce is dropped and recorded in `state.dropped` as `constraint.<kind>` (`unknownFields: "drop"`, the default), or rejected with `unsupported_field` (`"error"`), the same as an unaccepted sampling field. On an Anthropic-protocol or Ollama upstream, and on vLLM's native `/v1/messages`, a constraint has nothing to map to and is recorded as `constraint`. The drop is recorded in `state.dropped` only for requests that are converted; an OpenAI request forwarded as it is has no state to record it in.

`structured_outputs` replaced the `guided_*` request fields in vLLM; 0.11.0 is the boundary the driver uses, and an unknown version is treated as the newest. The OpenAI front's `passthroughFilter` lets vLLM's `structured_outputs` and `guided_*` fields through for `vllm` and `compatible` upstreams, and llama.cpp's `grammar` and `json_schema`, so a client that already speaks a backend's native fields keeps working.

**vLLM and tools.** vLLM applies a structured-outputs constraint to the whole generation, so a model constrained to a regex or a schema cannot also emit a tool call, and vLLM refuses a constraint together with a forced tool (`tool_choice` naming a function, or `required`); `tool_choice: "auto"` with a constraint does not give tool calls either. When the request offers tools (and `tool_choice` is not `none`), the translator therefore sends the tools and drops the constraint, recording `constraint.<kind>` in `state.dropped`. Send `tool_choice: "none"` to keep the constraint, or leave the tools out. The existing `output_config.format` / `response_format` path is unchanged. This is the translator's reading of vLLM's documented behaviour and has not been run against a real server (FI-138).

Nothing here has been run against a real backend: the field names come from each backend's documentation.

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
