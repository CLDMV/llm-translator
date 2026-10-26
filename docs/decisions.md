# Decision register

Binding design decisions for `@cldmv/llm-translator`. Each entry records the context, the decision, the rationale and the alternatives that were weighed. Identifiers are stable; superseded decisions stay in the list with a note.

Scope: the library translates between Anthropic Messages and OpenAI Chat Completions, with vLLM-class OpenAI-compatible servers as the primary target and Claude Code as the primary client.

## Architecture and module system

### D-01 Slothlet is the module system

- **Context.** The library exposes a large, nested surface (converters, drivers, server, helpers) that should be composable, lazily or eagerly loadable and extensible by third parties.
- **Decision.** `createTranslator(config)` builds a slothlet instance over `src/api` in eager mode and returns the slothlet API. There is no extra instance layer; slothlet instances are already isolated.
- **Rationale.** Slothlet already provides isolation, context propagation and runtime mounting, and the surrounding projects use it.
- **Alternatives.** A hand-rolled class with methods (more code, no mounting of third-party drivers); lazy mode (startup cost is small, eager keeps latency predictable).

### D-02 API naming follows directory nesting

- **Context.** Slothlet derives endpoint names from file paths.
- **Decision.** Multi-word concepts become a directory plus a single-word leaf (`token/count.mjs` becomes `api.token.count`, never `countTokens`). Each file exports one function named like the file. Internal helpers live in `src/lib` so they stay off the API.
- **Rationale.** Produces a browsable namespace and matches how slothlet is meant to be used.
- **Alternatives.** camelCase leaves (works, but fights the flatten model).

### D-03 Context inside streams is captured before the generator is returned

- **Context.** Slothlet `context` and `self` are only valid synchronously inside a call, and stream converters return async generators.
- **Decision.** A leaf that returns an async generator captures what it needs (`context.config`, `context.state`, `self.*` functions) before returning it. The converters in this library are pure and need no context.
- **Rationale.** Verified behaviour of slothlet; avoids lost-context errors in long streams.
- **Alternatives.** Re-entering the context per chunk (not supported).

### D-04 Converters are pure

- **Context.** Conversion must be testable without a network and reusable inside any host.
- **Decision.** The converters do no I/O. Network access happens only in detection, `send`, token counting, model listing and the server. The one exception is the PDF pipeline, which parses bytes it is handed and loads its libraries explicitly.
- **Rationale.** Determinism and easy fixtures.
- **Alternatives.** Fetching URL documents inside conversion (rejected, see D-27).

### D-05 Build mirrors the source tree and has no top-level await

- **Context.** Slothlet scans `api/` at runtime, and the CommonJS entry loads the ESM entry through `require(esm)`.
- **Decision.** `tsup` builds each source file separately (`bundle: false`) into `dist/` with the same layout; `src/index.cjs` is copied unchanged. No module in the entry graph uses top-level await; `lib/pdf.mjs` exposes an explicit async `load()`.
- **Rationale.** `require(esm)` rejects graphs with top-level await, and the runtime directory scan needs the tree.
- **Alternatives.** A single bundle (breaks the runtime scan).

### D-06 Code style and tooling

- **Decision.** Tabs, print width 140, ESM `.mjs`, JSDoc on every exported function (types are generated from it), file headers added by `fix:headers`, lint and format checks must pass.
- **Rationale.** Fleet conventions.

### D-07 Tests: 100% coverage without ignore pragmas

- **Context.** The converters are small and fully testable.
- **Decision.** Statements, branches, functions and lines are held at 100% with no coverage-ignore comments. Tests live in `tests/**/*.test.vitest.mjs`, run through the repository scripts only, and create slothlet instances with `import: (url) => import(url)` so coverage attributes to the leaves. Network tests use a fake transport or a local HTTP server.
- **Rationale.** A guard that cannot be driven is a design smell; reachable-but-hard cases are driven with injected failures (for example a failing importer for the PDF libraries).
- **Alternatives.** Ignore pragmas for defensive branches (rejected, they hide measurement problems).

## Conversion behaviour

### D-08 Inline system messages become tagged user text by default

- **Context.** Claude Code sends `role: "system"` messages inside `messages` on every turn (system reminders, token counters). Most chat templates reject a non-leading system message.
- **Decision.** Setting `inlineSystem` with `auto`, `keep`, `hoist`, `user`, `drop`. The converters treat `auto` as `user`: the text is wrapped in `<system-reminder>` tags and merged into the adjacent user turn, or becomes its own user turn after tool messages; text that is already wrapped is not wrapped again. The vLLM driver can resolve `auto` to `keep` after probing the chat template with `/tokenize`.
- **Rationale.** Keeps message order and a byte-stable prompt prefix, so prefix caching keeps working.
- **Alternatives.** Hoisting into the leading system message (matches Anthropic's compatibility layer but moves volatile text to the front and defeats caching); dropping (loses information).

### D-09 The billing header block is always stripped

- **Decision.** The `x-anthropic-billing-header` system block is removed (`stripBillingHeader`, default on).
- **Rationale.** It changes per request and would break prefix caching; vLLM's own Anthropic bridge strips it too.

### D-10 Consecutive same-role turns are merged

- **Decision.** Adjacent user turns (including folded system text) and adjacent assistant turns are merged; all-text user content is joined with a blank line into one string.
- **Rationale.** Anthropic merges them itself, strict-alternation templates require it, and plain strings suit every template.
- **Alternatives.** Keep separate parts (some templates join with a single newline and lose paragraph structure).

### D-11 Tool search is forwarded best-effort

- **Context.** Claude Code sends a placeholder tool with `defer_loading` and receives `tool_reference` blocks.
- **Decision.** Deferred tools are sent as ordinary function tools (flag removed, or dropped with `deferredTools: "drop"`), and a `tool_reference` block is rendered as text naming the tool. Documentation recommends `ENABLE_TOOL_SEARCH=false` for local models.
- **Rationale.** Works on models that cope with it without needing server support.
- **Alternatives.** Rejecting these constructs and requiring the client setting.

### D-12 PDFs are handled like the Anthropic API does

- **Context.** Anthropic preprocesses PDFs into per-page text plus page images; vLLM's chat API has no document input.
- **Decision.** `document` blocks convert to page text always, and to a PNG per page (up to `pdf.maxImages`) when `images` is on and `@napi-rs/canvas` loaded. Anthropic-like limits apply (100 pages, 32 MB) and violations are errors. Unreadable PDFs (corrupt, encrypted) become a text note that includes the tool call's `file_path` and a `pdftotext -layout` hint when known. `documents: "extract" | "note" | "error"` and a `documentConverter` hook override the behaviour. Plain-text and content documents convert directly. URL documents become a note.
- **Rationale.** Drop-in behaviour for Claude Code's Read tool, with a graceful path on failure.
- **Alternatives.** Rejecting documents (breaks the PDF workflow); text-only extraction (loses figures).

### D-13 Unsupported input is dropped and recorded, or rejected

- **Decision.** Fields and blocks with no mapping are removed and listed in `state.dropped` (`unknownFields: "drop"`, default), or rejected with a 400 (`"error"`). Fields that have no effect on the other side (`metadata`, `cache_control`, `service_tier`) are dropped silently.
- **Rationale.** No silent corruption; tests and docs can assert what was lost.

### D-14 Thinking becomes marked blocks and returns as reasoning

- **Context.** Local servers return reasoning as `reasoning`, `reasoning_content` or `<think>` text, with no signature.
- **Decision.** Received reasoning becomes a `thinking` block with a translator-marked signature (`llmt:` plus base64url JSON). Thinking blocks coming back in history are sent as `reasoning` (field chosen by `reasoningField`) with signatures discarded, empty ones skipped, `redacted_thinking` dropped. Anthropic `thinking` is requested through `chat_template_kwargs` or `reasoning_effort` (`thinking`), with `thinkingBudget` and `effort` opt-ins. `context_management` `clear_thinking` limits replayed reasoning locally.
- **Rationale.** Claude Code requires well-formed thinking blocks; a marked signature makes the origin explicit.
- **Alternatives.** Random signatures (vLLM's bridge does this; no way to tell origin); dropping reasoning (loses interleaved thinking).

### D-15 Only a leading think block is parsed

- **Decision.** With `thinkTags`, only a leading `<think>...</think>` (whitespace tolerated, unterminated treated as all reasoning) is recognised, in both streaming and non-streaming conversion.
- **Rationale.** A closing tag alone cannot be classified while streaming. Tracked as FI-081.
- **Alternatives.** A heuristic on a bare `</think>` (misclassifies ordinary text).

### D-16 Tool arguments that are not an object are preserved, not invented

- **Decision.** Invalid or non-object arguments become `input: { "_raw_arguments": "<original>" }`. A `finish_reason: "length"` that cut the last tool call off mid-JSON maps to `stop_reason: "max_tokens"` rather than `tool_use`, so the client does not run a half-finished call; a complete call, or a normal or forced call finishing with `stop` or `tool_calls`, stays `tool_use`.
- **Rationale.** The client's own validation reports an error the model can recover from. vLLM's Anthropic bridge returns HTTP 500 here.
- **Alternatives.** Throwing (fails the whole turn); substituting `{}` (silently runs a tool with wrong input).

### D-17 Tool names are fitted and restored

- **Decision.** Names that already match the target rules pass through. Others are sanitized, shortened with a hash suffix when too long, kept unique, and recorded in `state.toolNames` (fitted to original) so replies restore the original. Tool-call ids are not remapped from Anthropic to OpenAI; from OpenAI to Anthropic invalid characters become `_` deterministically and missing ids get a fresh `toolu_` id.
- **Rationale.** Anthropic allows 128-character names, OpenAI 64; consistent mapping keeps calls and results paired across turns without storing state.

### D-18 Streaming tool calls: buffered by default, optionally incremental

- **Context.** vLLM tool-call deltas take three shapes (id and name first then fragments; name and arguments together; whole call at once), and text, reasoning and parallel calls may arrive between a call's fragments, possibly interleaved with other calls' fragments. Anthropic content blocks are strictly sequential, so a text block cannot appear between the start and the end of a tool block, and a fragment cannot be added to a block that has already been closed.
- **Decision.** The setting `toolStreaming` chooses the trade-off. `buffer` (default) holds every tool call until the stream finishes (`finish_reason`, `[DONE]` or the end of the source) and then emits all of them in index order, each as one block (start, one `input_json_delta`, stop). Text and thinking stream immediately in arrival order, so they always appear before the tool blocks. Because nothing is emitted before the end, a fragment can never arrive too late and `buffer` mode has no error case for it. A `length` stop whose highest-index call has incomplete JSON arguments is `max_tokens`. `stream` forwards argument fragments incrementally; a call that starts while a tool block is streaming is buffered and emitted whole when it closes, and text that arrives meanwhile is held until the tool blocks are done.
- **Rationale.** A tool call ends the turn, so waiting for the end of the stream delays nothing the client could act on; pings already cover the silence. The cost is that Claude Code shows tool arguments all at once instead of as they are generated, and total completion time is unchanged because the model finishes generating either way. `stream` keeps incremental display for clients that want it.
- **Alternatives.** Completing a call when the next index starts (breaks on interleaved fragments); always streaming (reorders text that arrives mid-call); always buffering with no switch (removes incremental argument display for good).

### D-19 Incomplete streams are errors, never fabricated completions

- **Decision.** A stream with no data, or with neither `finish_reason` nor `[DONE]`, yields an Anthropic `error` event. A mid-stream `{"error": ...}` object becomes an `error` event and ends the stream.
- **Rationale.** Claude Code treats a missing final `message_delta` as a dropped connection and retries; a fake `message_stop` would hide the failure.

### D-20 Reply model and ids

- **Decision.** `message_start.message.model` echoes the client's requested model, falling back to the upstream's. Message ids are regenerated (`msg_`, `chatcmpl-`).
- **Rationale.** Clients key behaviour on the model they asked for.

### D-21 Usage mapping

- **Decision.** Cached prompt tokens (reported by vLLM only with prompt-token details enabled) become `cache_read_input_tokens` and are subtracted from `input_tokens`; `cache_creation_input_tokens` is 0. `message_start` takes input tokens from the first chunk when `continuous_usage_stats` is on; `message_delta.usage` carries the final cumulative numbers, including from a usage-only last chunk. Streaming requests ask for usage by default (`streamUsage`); `continuousUsage` (default off, set by the vLLM driver) additionally requests per-chunk usage.
- **Rationale.** Matches Anthropic accounting, where cache reads are excluded from `input_tokens`.

### D-22 Context-overflow errors are rewritten

- **Decision.** vLLM context-length 400s are rewritten as `prompt is too long: <n> tokens > <max> maximum` with `n` the total requested (prompt plus completion) when the message reports it, the prompt size otherwise, and `max + 1` when no size is given. The helper is `rewriteContextOverflow` in `lib/errors.mjs`.
- **Rationale.** Claude Code recognises that wording and auto-compacts; using the total keeps `n` above the maximum.

### D-23 Errors use the client's protocol

- **Decision.** Upstream errors are returned in the client protocol's shape with status codes mapped one to one (`retry-after` kept on 429). `TranslatorError` carries code, status, type and param and renders either shape.
- **Error type names.** HTTP status codes are never changed, because they drive client retries. Only the Anthropic `error.type` follows this table: 400 `invalid_request_error`, 401 `authentication_error`, 403 `permission_error`, 404 `not_found_error`, 413 `request_too_large`, 429 `rate_limit_error`, 503 and 529 `overloaded_error`, and every other status (including 502, 504 and the translator's own 502 errors such as `invalid_stream_data` and `invalid_upstream_response`) `api_error`. This supersedes the earlier mapping of 502 and 504 to `overloaded_error`.

### D-24 Keep-alives belong to the SSE writer and must be real stream events

- **Context.** Claude Code treats a stream with no real event for 300 seconds as dead, aborts it and resends the request; `event: ping` does not count as an event for that watchdog (observed in its debug log and reproduced against a delayed fake upstream). A local model can stay silent far longer than that during prefill, and vLLM only sends response headers with the first token.
- **Decision.** The server and the `sse` helper write a keep-alive whenever the upstream is silent for `pingInterval` (0 disables). On the Anthropic front it is an empty delta of the open content block's type; `event: ping` is the fallback when no block is open. When the reply has to be committed before the upstream answers, `message_start` and an empty thinking block are sent at once so there is an open block for the keep-alives, and the upstream's blocks are shifted by one index afterwards. The pure converters never emit keep-alives.
- **Rationale.** Empty deltas are valid, change no content and are counted as activity by the client; timing is a transport concern. vLLM's own Anthropic bridge sends none and would hit the same watchdog.
- **Alternatives.** Plain `ping` events (ignored by the watchdog); raising Claude Code's timeouts (capped, and requires client configuration); buffering the whole reply (loses streaming).

### D-25 OpenAI to Anthropic requests drop assistant reasoning

- **Decision.** Reasoning on assistant history is dropped (recorded) because real Anthropic rejects thinking blocks without its own signatures. `system` and `developer` messages hoist to the top-level `system`, `temperature` clamps to 1, `n > 1` errors, a missing `max_tokens` becomes `defaultMaxTokens` (8192), `reasoning_effort` maps to `thinking` plus `output_config.effort`, and `json_schema` maps to `output_config.format`.
- **Rationale.** Anthropic's constraints, with the nearest legal values.

### D-26 Images default on, PDF page images default on

- **Decision.** `images` and `pdf.pages` default to true so a multimodal model gets page images. Text-only models need `images: false`, which a driver can set from probing.
- **Rationale.** Drop-in behaviour for the common multimodal case.
- **Alternatives.** Default off (silently degrades PDFs for multimodal models).

### D-27 URL documents are not fetched during conversion

- **Decision.** `document` blocks with a `url` source become a note unless `documentConverter` handles them. Tracked as FI-046.
- **Rationale.** Conversion is pure (D-04); fetching needs allow-lists, limits and SSRF protection that belong in a separate component.

### D-28 SSE parsing details

- **Decision.** Events carry their `id` only for that event (no sticky last-event-id). Invalid JSON in event data raises `invalid_stream_data` (HTTP 502). Accepted stream inputs are SSE text or bytes, `ReadableStream`, async and sync iterables, parsed `{ event, data }` pairs and bare payload objects.
- **Rationale.** Simplicity for a protocol where ids are unused; flexible inputs make testing and in-process use easy.

### D-29 Test fixtures are committed copies

- **Decision.** Captured Claude Code requests used by tests are stored under `tests/fixtures/claude-code/` so tests do not depend on ignored directories.

## Drivers, routing and server

### D-30 Request state is an envelope

- **Context.** The converters return an opaque `state` that the reverse converters need, but the runtime also has to know which upstream served a request, which front it came from and whether it was forwarded natively.
- **Decision.** `request()` returns `state = { v, upstream, front, native, model, stream, convert }` with the converter state nested in `convert`. The original client model name stays in `state.model`; converters receive the original body and `body.model` is rewritten to the alias target afterwards.
- **Rationale.** `response`, `stream` and `error` can resolve the endpoint, driver and settings from `state` alone, and the client always sees the model name it asked for.
- **Alternatives.** Extending the converter state (couples the runtime to converter internals); a request-id registry in translator state (leaks memory, breaks stateless use).

### D-31 Detection binds drivers once; explicit backends never touch the network

- **Context.** Probing on every request adds latency, and operators who know their backend should not pay for probes.
- **Decision.** Each upstream is bound to a driver at creation (or on `detect()`), trying drivers in `info().order` with the generic driver matching last. An explicit `backend` or `detect: false` skips every request; `inlineSystem: "auto"` then resolves to `user`. Settings precedence is upstream `settings`, global `settings`, probed values, driver settings, library defaults.
- **Rationale.** Predictable startup, no hidden network use, and a safe default for the one setting that needs a request to verify.
- **Alternatives.** Lazy detection on the first request (surprising latency and errors on the first call); probing even with an explicit backend.

### D-32 Hosted APIs are detected by host name only

- **Context.** The OpenAI and Anthropic APIs need credentials to probe, and probing arbitrary servers for Anthropic compatibility is unreliable.
- **Decision.** The `openai` and `anthropic` drivers match `api.openai.com` and `api.anthropic.com` without network access. Other Anthropic-compatible servers set `backend: "anthropic"`.
- **Rationale.** The hosts are unambiguous, and the explicit setting is a complete workaround. Automatic detection of other hosts is tracked as FI-175.
- **Alternatives.** A response-shape probe (risk of binding OpenAI-style servers wrongly).

### D-33 Routing: alias, serving endpoint, default; native forwarding when protocols match

- **Context.** One translator can front several upstreams that serve different models, and sometimes the client and the upstream already speak the same protocol.
- **Decision.** The alias map rewrites the model name, then the first upstream that serves it wins (from its `models` list or from detection; an Anthropic-protocol upstream without a list serves `claude-*`), then the upstream marked `default`, then the first; when nothing serves the model and that fallback knows exactly one model, that model is sent instead and the client's name is restored. When the protocols match, only the driver normalizers run and the client's model name is restored on the way back.
- **Rationale.** Simple, predictable and cheap. Native forwarding avoids two lossy conversions.
- **Alternatives.** Weighted pools and failover (tracked as FI-169); always converting.

### D-34 Driver contract and version mapping

- **Context.** Backends differ in detection, defaults and small wire quirks, and third parties need to add their own.
- **Decision.** A driver is a folder of leaves under `api/driver/<name>/` (`info`, `detect`, `settings`, optional `probe`, normalizers, `token/count`, `model/list`). The vLLM driver maps the detected version to settings: `reasoning_content` below 0.16.0, `thinking_token_budget` from 0.19.0, `reasoning_effort` mapping from 0.22.0; `continuousUsage` is on only for vLLM. An unknown version counts as the newest. Third parties mount drivers with `api.slothlet.api.add(["driver", name], dir)`.
- **Rationale.** Uses slothlet's own composition, keeps converters free of backend knowledge, and keeps the version table in one place.
- **Alternatives.** A central capability table in the converters; subclassing drivers.

### D-35 The server commits to the stream early while the upstream is silent

- **Context.** vLLM sends response headers together with the first token, so a long prefill or a long thinking phase leaves the client with a silent connection that Claude Code treats as dropped. Pings cannot be sent before the response status is chosen.
- **Decision.** For streaming requests the server waits `pingInterval` for the upstream. If it has not answered, it commits to HTTP 200 with SSE and pings; a later upstream error is delivered in-band (`event: error`, or an error chunk followed by `[DONE]`). If the upstream answers in time, its real status is used. `pingInterval: 0` disables the early commit. The Anthropic front pings with `event: ping`, the OpenAI front with an SSE comment frame.
- **Rationale.** Real status codes are kept in the common case (Claude Code's prompt-too-long recovery and retries depend on them) while slow requests stay alive.
- **Alternatives.** Always committing to 200 (loses status codes); never pinging before headers (long requests die); a raw socket write before the status line (invalid HTTP).

### D-36 `send` returns errors instead of throwing

- **Context.** Server code wants to hand the result to the client unchanged, and library users want one code path for success and failure.
- **Decision.** Upstream errors, conversion errors and unreachable upstreams come back as client-shaped replies. Only an abort of the caller's signal or a programmer error throws.
- **Rationale.** The reply is already in the front's protocol, with `retry-after` kept.
- **Alternatives.** Throwing `TranslatorError` for everything (forces every caller to render errors).

### D-37 Server surface, authentication and token counting

- **Context.** The server has to serve Claude Code unchanged and embed in other applications.
- **Decision.** `server.start` takes only server options (`host`, `port`, `front`, `apiKey`, `bodyLimit`, `logger`, `allowUnauthenticated`); translator configuration belongs to `createTranslator`. A `front` option applies to that server or plugin instance only. A non-loopback bind without an API key is refused unless explicitly allowed. Forwarded OpenAI bodies are filtered to known fields and only allow-listed client headers reach a native Anthropic upstream. API keys are accepted as `x-api-key` or Bearer with constant-time comparison, and the health routes are public. Client disconnects are detected on the response and abort the upstream request. Token counting uses vLLM `/tokenize` or Anthropic `count_tokens` when the driver offers it, and an estimate of one token per four characters otherwise. The CLI merges flags, environment variables and a JSON file in that order of precedence.
- **Rationale.** One place to configure the translator; the request stream's `close` event fires too early to detect a disconnect; exact counts matter for Claude Code's context accounting where the backend can provide them.
- **Alternatives.** Per-start translator config (duplicates settings); an auth-less server (unsafe when bound to a network).

### D-38 Retry once without images when a model refuses them

- **Context.** Only the vLLM driver can probe whether a model accepts images. A text-only model behind any other OpenAI-protocol upstream answers every request that carries an image or a rendered PDF page with a 400, which fails the whole conversation.
- **Decision.** When a request that carried images is answered 400 with a message matching a known "no image input" wording, `send` retries once with images removed (image blocks and PDF page images become a short text note, PDFs keep their text) and remembers the endpoint and model as text-only until the process ends. Controlled by the `imageFallback` setting (default `true`). Other 400s, requests without images and Anthropic-protocol upstreams are never retried.
- **Rationale.** Recovers the conversation without configuration and costs one extra round trip per process and model. The narrow wording match avoids hiding genuine request errors.
- **Alternatives.** Requiring `images: false` by hand (fails every PDF read until configured); probing every driver at startup (no generic probe exists); retrying on any 400 (masks real errors).
