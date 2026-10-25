# Known limitations

The converters favour a faithful, explicit result over a clever guess. Where something cannot be translated it is dropped and recorded in `state.dropped`, rejected with an error, or replaced by a text note. The list below is what a user is most likely to run into. Feature identifiers refer to [feature-inventory.md](feature-inventory.md).

## Reasoning

- Only a leading `<think>...</think>` block in content is parsed as reasoning. A model whose chat template opens the think block in the prompt, so the reply contains only a closing `</think>`, keeps that text in the answer (FI-081, [#23](https://github.com/CLDMV/llm-translator/issues/23)).
- Reasoning blocks produced by the translator carry a marked signature (`llmt:...`). They are not Anthropic signatures and are not accepted by real Anthropic endpoints. When an OpenAI client talks to an Anthropic upstream, assistant reasoning in history is dropped.
- `redacted_thinking` blocks are dropped. Thinking `display` modes and `between_tools` thinking have no effect.
- Servers that require reasoning to be sent back on every turn (DeepSeek with tools, OpenRouter's structured `reasoning_details`) are not supported yet; reasoning goes back as plain text only.

## Tools

- Anthropic server tools (`web_search_*`, `web_fetch_*`, `code_execution_*`, `tool_search_*`) and Anthropic-defined client tool types (`bash_*`, `text_editor_*`, `computer_*`, `memory_*`) are dropped. A request that only carries such tools reaches the model with no tools. Server tools: [#5](https://github.com/CLDMV/llm-translator/issues/5).
- `server_tool_use` and server tool result blocks in history are dropped; `pause_turn` is never produced.
- Only one content block streams at a time. Parallel tool calls whose fragments interleave are buffered and delivered as complete blocks once the open block closes, so a later call's arguments arrive in one piece rather than incrementally. Text and reasoning that arrive while a tool block is open are held until the tool blocks are complete, so they appear after the tool calls in the block order.
- Streamed tool-call arguments are forwarded as received. Truncated JSON (for example after a `length` stop) reaches the client as is, but the stop reason is then `max_tokens` instead of `tool_use`; non-streaming replies wrap invalid arguments as `{ "_raw_arguments": "..." }`.
- Tools using `defer_loading` are sent as ordinary tools. Models vary in how well they cope with Claude Code's tool search; `ENABLE_TOOL_SEARCH=false` in Claude Code avoids it. Tracked in [#56](https://github.com/CLDMV/llm-translator/issues/56).
- `is_error` on tool results is lost unless `toolErrors` is enabled, because Chat Completions has no error flag. Tracked in [#58](https://github.com/CLDMV/llm-translator/issues/58).
- Tool-call ids are not shortened or reformatted for servers with strict id formats (FI-067, [#20](https://github.com/CLDMV/llm-translator/issues/20)).
- `strict` tool schemas are forwarded; whether the server enforces them depends on its configuration. Tracked in [#57](https://github.com/CLDMV/llm-translator/issues/57).

## Content

- `document` blocks with a `url` source are replaced by a text note because conversion does no network I/O (FI-046, [#18](https://github.com/CLDMV/llm-translator/issues/18)). A `documentConverter` hook can fetch them.
- Files API references (`file` image and document sources, `file_id` parts) are not resolved. Tracked in [#17](https://github.com/CLDMV/llm-translator/issues/17).
- Citations (`citations` on text blocks and documents, citation deltas, OpenAI annotations) are dropped. `search_result` blocks become plain text. Tracked in [#16](https://github.com/CLDMV/llm-translator/issues/16).
- PDF page images are only produced when the model accepts images, `@napi-rs/canvas` loaded, and the page budget (`pdf.maxImages`) allows. Scanned PDFs without a text layer yield empty page text; there is no OCR.
- Encrypted or corrupt PDFs fall back to a text note. PDFs over 100 pages or 32 MB are rejected with an Anthropic-shaped error.
- Audio, video and file-by-id inputs on the OpenAI side are dropped when converting to Anthropic. File references: [#17](https://github.com/CLDMV/llm-translator/issues/17).
- Assistant prefill depends on the chat template; templates that inject thinking into the generation prompt may behave unpredictably.

## Requests and responses

- `n` greater than 1 is rejected when converting to Anthropic and ignored (first choice only) when reading replies (FI-097, [#26](https://github.com/CLDMV/llm-translator/issues/26)). There is no fan-out.
- Sampling and penalty fields without an Anthropic equivalent (`seed`, `logprobs`, `logit_bias`, `frequency_penalty`, `presence_penalty`, and so on) are dropped when converting to Anthropic. Newer Anthropic API versions also reject `temperature`, `top_p` and `top_k` themselves.
- Prompt caching hints (`cache_control`) are dropped. `cache_creation_input_tokens` is always 0; cache reads are reported only when the server exposes `cached_tokens`. Tracked in [#15](https://github.com/CLDMV/llm-translator/issues/15).
- A server that returns no usage yields zero token counts (FI-074, [#22](https://github.com/CLDMV/llm-translator/issues/22)).
- `context_management` is emulated for `clear_thinking` only. Other edit types are dropped. Tracked in [#13](https://github.com/CLDMV/llm-translator/issues/13).
- Non-standard finish reasons (`abort`, `eos`, `error`, and similar) are treated as `end_turn`. Tracked in [#27](https://github.com/CLDMV/llm-translator/issues/27).
- `stop_details` and refusal categories are not produced. `model_context_window_exceeded` is never produced. Tracked in [#21](https://github.com/CLDMV/llm-translator/issues/21).
- Structured output is limited to `response_format` JSON Schema. Native grammar, regex and choice constraints of individual servers are not exposed. Tracked in [#14](https://github.com/CLDMV/llm-translator/issues/14).
- The response `model` echoes the model the client asked for, not the one the upstream reports.
- `anthropic-version` and `anthropic-beta` are ignored.

## Streaming

- A stream that ends without `finish_reason` and without `[DONE]`, or with no data, becomes an `error` event rather than a completed message.
- Pings are not produced by the pure stream converters; the SSE writer adds them while the upstream is silent.
- Stream converters accept SSE text or bytes, iterables and parsed chunks, but a single malformed SSE data line ends the stream with an error event.

## Out of scope

- Message Batches, Files, Skills, Responses, Conversations, Realtime, audio, image, embeddings and moderation endpoints are not provided. Batches: [#25](https://github.com/CLDMV/llm-translator/issues/25), [#29](https://github.com/CLDMV/llm-translator/issues/29); Responses: [#4](https://github.com/CLDMV/llm-translator/issues/4).
- Server-side features of the Anthropic platform (MCP connector, container, fast mode, service tiers, task budgets, server-side fallback) have no equivalent on local servers.
- Backend-specific behaviour beyond what the vLLM, OpenAI, Anthropic and generic OpenAI-compatible drivers implement (llama.cpp, Ollama, SGLang, LM Studio, TGI, LocalAI and hosted providers) is not special-cased yet. Driver issues start at [#33](https://github.com/CLDMV/llm-translator/issues/33).
