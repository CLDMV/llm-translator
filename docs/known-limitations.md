# Known limitations

The converters favour a faithful, explicit result over a clever guess. Where something cannot be translated it is dropped and recorded in `state.dropped`, rejected with an error, or replaced by a text note. The list below is what a user is most likely to run into. Feature identifiers refer to [feature-inventory.md](feature-inventory.md).

## Reasoning

- Only a leading `<think>...</think>` block in content is parsed as reasoning. A model whose chat template opens the think block in the prompt, so the reply contains only a closing `</think>`, needs `thinkOpen: true`; the stream then emits nothing until the `</think>` arrives or the stream ends (FI-081, [#23](https://github.com/CLDMV/llm-translator/issues/23)).
- Reasoning blocks produced by the translator carry a marked signature (`llmt:...`). They are not Anthropic signatures and are not accepted by real Anthropic endpoints. When an OpenAI client talks to an Anthropic upstream, assistant reasoning in history is dropped unless `reasoningRoundTrip` is on and the client replays the `reasoning_details` items it was given (D-46).
- `redacted_thinking` blocks are dropped. Thinking `display` modes and `between_tools` thinking have no effect.
- Servers that require reasoning to be sent back on every turn (DeepSeek with tools, OpenRouter's structured `reasoning_details`) are supported through `reasoningRoundTrip` (on for the DeepSeek driver). It depends on the client keeping the signature of each thinking block; a client that drops thinking blocks, or `clear_thinking` removing old turns, leaves nothing to restore. Such a turn is sent without reasoning, one warning is printed per upstream, and the server may refuse it (DeepSeek's refusal is explained in the error). OpenRouter and its `reasoning_details` shapes have not been verified against the real service (no driver yet, [#41](https://github.com/CLDMV/llm-translator/issues/41)).

## Tools

- Anthropic server tools (`web_search_*`, `web_fetch_*`, `code_execution_*`, `tool_search_*`) and Anthropic-defined client tool types (`bash_*`, `text_editor_*`, `computer_*`, `memory_*`) are dropped. A request that only carries such tools reaches the model with no tools. Server tools: [#5](https://github.com/CLDMV/llm-translator/issues/5).
- `server_tool_use` and server tool result blocks in history are dropped; `pause_turn` is never produced.
- Only one content block streams at a time. With the default `toolStreaming: "buffer"`, every tool call is held until the stream finishes and then delivered as one complete block in index order, so tool arguments are not displayed incrementally (total completion time is unchanged, and pings cover the silence). Text and thinking still stream and always appear before the tool blocks. With `toolStreaming: "stream"`, arguments stream incrementally for the first call, later parallel calls arrive as whole blocks, and text that arrives while a tool block is open is held until the tool blocks are done, so it appears after them.
- Streamed tool-call arguments are forwarded as received. Truncated JSON (for example after a `length` stop) reaches the client as is, but the stop reason is then `max_tokens` instead of `tool_use`; non-streaming replies wrap invalid arguments as `{ "_raw_arguments": "..." }`.
- Claude Code's tool search works through the translator (`toolSearch`: `expand` by default), but it costs the model an extra `ToolSearch` call before it can use a deferred tool, and it has not been run against a real backend yet ([#65](https://github.com/CLDMV/llm-translator/issues/65)). Small models that do not call tools reliably should use `ENABLE_TOOL_SEARCH=false` in Claude Code. See [claude-code.md](claude-code.md#tool-search).
- `is_error` on tool results is lost unless `toolErrors` is enabled (off for every driver), because Chat Completions has no error flag. The marker text is `toolErrorMarker`; `toolErrorInference` reads it back in the other direction. Tracked in [#124](https://github.com/CLDMV/llm-translator/issues/124).
- Tool-call ids are reformatted only for an upstream whose driver declares `toolCallIds` (FI-067, [#20](https://github.com/CLDMV/llm-translator/issues/20)). Only the `mistral` driver declares it, so any other server with a strict id format still sees the client's ids. An id the upstream makes itself passes to the client as it is (sanitized to the Anthropic pattern on the Anthropic front).
- `strict` tools are carried to the upstream and their schemas are checked against the strict subset, but the translator cannot tell whether a server really enforces them: the `vllm` driver reports that it can, and enforcement there depends on its `--tool-strict-level` setting. Schemas outside the subset are reported and sent without `strict`, so that tool is not enforced. Tracked in [#120](https://github.com/CLDMV/llm-translator/issues/120).

## Content

- `document` blocks with a `url` source are replaced by a text note because conversion does no network I/O (FI-046, [#18](https://github.com/CLDMV/llm-translator/issues/18)). A `documentConverter` hook can fetch them.
- Files API references (`file` image and document sources, `file_id` parts) are not resolved. Tracked in [#17](https://github.com/CLDMV/llm-translator/issues/17).
- Citations (`citations` on text blocks and documents, citation deltas, OpenAI annotations) are dropped. `search_result` blocks become plain text. Tracked in [#16](https://github.com/CLDMV/llm-translator/issues/16).
- PDF page images are only produced when the model accepts images, `@napi-rs/canvas` loaded, and the page budget (`pdf.maxImages`) allows. Scanned PDFs without a text layer yield empty page text; there is no OCR.
- Encrypted or corrupt PDFs fall back to a text note. PDFs over 100 pages or 32 MB are rejected with an Anthropic-shaped error.
- A text-only model behind a non-vLLM upstream is only discovered on the first request that carries an image: that request is sent twice (the second time without images) and the model is remembered as text-only for the rest of the process. The wording match is deliberately conservative, so a server that refuses images with an unusual message still returns its 400; set `images: false` for it. See `imageFallback` in [settings](settings.md).
- Audio, video and file-by-id inputs on the OpenAI side are dropped when converting to Anthropic. File references: [#17](https://github.com/CLDMV/llm-translator/issues/17).
- Assistant prefill depends on the chat template; templates that inject thinking into the generation prompt may behave unpredictably.

## Requests and responses

- `n` greater than 1 is rejected when converting to Anthropic and ignored (first choice only) when reading replies (FI-097, [#26](https://github.com/CLDMV/llm-translator/issues/26)). There is no fan-out.
- Sampling and penalty fields without an Anthropic equivalent (`seed`, `logprobs`, `logit_bias`, `frequency_penalty`, `presence_penalty`, and so on) are dropped when converting to Anthropic. Newer Anthropic API versions also reject `temperature`, `top_p` and `top_k` themselves.
- Prompt caching hints (`cache_control`) are dropped. `cache_creation_input_tokens` is always 0; cache reads are reported only when the server exposes `cached_tokens`. Tracked in [#15](https://github.com/CLDMV/llm-translator/issues/15).
- When a server returns no usage (or only one side of it), a converted reply carries estimates for the missing side (the server tokenizer's count or one token per four characters) instead of zeros, and a usage report keeps them apart in `estimated`. Replies passed through without conversion are not altered, and on the Anthropic front `message_start` still reports 0 input tokens because the estimate is only known at the end of the stream (FI-074, [#22](https://github.com/CLDMV/llm-translator/issues/22)).
- `context_management` is emulated for `clear_thinking` only. Other edit types are dropped. Tracked in [#13](https://github.com/CLDMV/llm-translator/issues/13).
- Non-standard finish reasons (`abort`, `eos`, `error`, and similar) are treated as `end_turn`. Tracked in [#27](https://github.com/CLDMV/llm-translator/issues/27).
- `stop_details` is produced for refusals, but its `category` is always null (OpenAI-style upstreams report none; tracked in [#123](https://github.com/CLDMV/llm-translator/issues/123)). `model_context_window_exceeded` is never produced.
- Structured output is limited to `response_format` JSON Schema. Native grammar, regex and choice constraints of individual servers are not exposed. Tracked in [#14](https://github.com/CLDMV/llm-translator/issues/14).
- The response `model` echoes the model the client asked for, not the one the upstream reports.
- `anthropic-version` and `anthropic-beta` are ignored.

## Streaming

- A stream that ends without `finish_reason` and without `[DONE]`, or with no data, becomes an `error` event rather than a completed message.
- Pings are not produced by the pure stream converters; the SSE writer adds them while the upstream is silent.
- Stream converters accept SSE text or bytes, iterables and parsed chunks, but a single malformed SSE data line ends the stream with an error event.

## Out of scope

- Message Batches, Files, Skills, Responses, Conversations, Realtime, audio, image and moderation endpoints are not provided. Embeddings are forwarded to OpenAI-protocol upstreams only. Batches: [#25](https://github.com/CLDMV/llm-translator/issues/25), [#29](https://github.com/CLDMV/llm-translator/issues/29); Responses: [#4](https://github.com/CLDMV/llm-translator/issues/4).
- Server-side features of the Anthropic platform (MCP connector, container, fast mode, service tiers, task budgets, server-side fallback) have no equivalent on local servers.
- Backend-specific behaviour beyond what the vLLM, llama.cpp, SGLang, Ollama, OpenAI, DeepSeek, Mistral, Anthropic and generic OpenAI-compatible drivers implement (LM Studio, TGI, LocalAI and other hosted providers) is not special-cased yet. Driver issues start at [#33](https://github.com/CLDMV/llm-translator/issues/33).
