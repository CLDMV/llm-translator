# Running Claude Code against vLLM

This walks through pointing Claude Code at a local vLLM server through the translator: Claude Code talks the Anthropic Messages protocol to the translator, which converts it to Chat Completions for vLLM and converts the answers back.

## 1. Start vLLM with tool calling and reasoning enabled

Claude Code is a tool-using agent, so the vLLM server must be able to parse tool calls. Without the first two flags vLLM answers `400` as soon as a request carries tools.

```bash
vllm serve Qwen/Qwen3-Coder-30B-A3B-Instruct \
  --served-model-name qwen3-coder \
  --enable-auto-tool-choice \
  --tool-call-parser qwen3_coder \
  --reasoning-parser qwen3 \
  --enable-prompt-tokens-details
```

- `--enable-auto-tool-choice` together with `--tool-call-parser <parser>` is mandatory for tools. Pick the parser that matches the model family (`qwen3_coder`, `hermes`, `glm45`, `kimi_k2`, `mistral`, and others).
- `--reasoning-parser <parser>` makes vLLM return reasoning separately, which the translator turns into Anthropic thinking blocks. Without a parser, `<think>…</think>` in the content is still parsed.
- `--enable-prompt-tokens-details` makes vLLM report cached prompt tokens, which the translator maps to cache usage. It is optional.
- Prefix caching is on by default in current vLLM, which matters because Claude Code resends a long, stable prefix on every turn.

## 2. Start the translator

```bash
npm install -g @cldmv/llm-translator fastify
llm-translator --upstream http://gpu-box:8000 --port 8787 --model claude-opus-5-5=qwen3-coder
```

The `--model` alias is optional; it lets Claude Code's default model names reach the local model. Detection finds vLLM and its version by itself.

## 3. Point Claude Code at it

```bash
export ANTHROPIC_BASE_URL=http://127.0.0.1:8787
export ANTHROPIC_AUTH_TOKEN=anything
export ANTHROPIC_MODEL=qwen3-coder
export ANTHROPIC_DEFAULT_OPUS_MODEL=qwen3-coder
export ANTHROPIC_DEFAULT_SONNET_MODEL=qwen3-coder
export ANTHROPIC_DEFAULT_HAIKU_MODEL=qwen3-coder
export CLAUDE_CODE_MAX_OUTPUT_TOKENS=8192
export ENABLE_TOOL_SEARCH=false
export CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1
claude
```

| Variable                                                         | Why                                                                                                                                                                                                                         |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ANTHROPIC_BASE_URL`                                             | the translator's address                                                                                                                                                                                                    |
| `ANTHROPIC_AUTH_TOKEN`                                           | sent as `Authorization: Bearer`; any value works unless the translator was started with `--api-key`, in which case use that key (`ANTHROPIC_API_KEY` is sent as `x-api-key` and works too)                                  |
| `ANTHROPIC_MODEL`, `ANTHROPIC_DEFAULT_{OPUS,SONNET,HAIKU}_MODEL` | model ids are sent verbatim; setting all of them avoids requests for model names the upstream does not serve (the alias flag is the alternative)                                                                            |
| `CLAUDE_CODE_MAX_OUTPUT_TOKENS`                                  | Claude Code asks for 32000 to 128000 output tokens by default; vLLM clamps oversized values, but a realistic cap keeps replies bounded                                                                                      |
| `ENABLE_TOOL_SEARCH=false`                                       | optional: Claude Code then sends every tool inline and no `ToolSearch`. The translator also handles tool search itself (see [Tool search](#tool-search)), so this is only needed for models that do not call tools reliably |
| `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1`                     | skips the connection warm-up probe and other optional traffic                                                                                                                                                               |

Not needed: `DISABLE_PROMPT_CACHING` (the translator drops `cache_control`, and vLLM caches prefixes on its own) and `CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS` (the translator already ignores beta fields, `context_management` and `defer_loading` are handled). `CLAUDE_CODE_ATTRIBUTION_HEADER=0` is also unnecessary: the translator strips the changing `x-anthropic-billing-header` system block so the prompt prefix stays byte-stable.

To let Claude Code list the translator's models, add `CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY=1`.

## Background requests for other model names

Claude Code also makes background requests (titles, summaries, classification) with its small-model setting, and its defaults are Claude model ids such as `claude-haiku-4-5`. The translator routes by model name, so an id that no upstream serves needs a decision:

- If the fallback upstream (the one marked `default`, else the first) serves exactly one model, that model is used and Claude Code still sees the name it asked for. With a single vLLM server this makes the extra requests work without any configuration.
- If the upstream serves several models, or its models are unknown, the name is sent unchanged and vLLM answers `404`. The error then names the model and points at `aliases`: add `--model claude-haiku-4-5=qwen3-coder` (or `aliases` in the config file), or set `ANTHROPIC_DEFAULT_HAIKU_MODEL` as shown above.

## What the translator handles for you

- Claude Code puts `role: "system"` reminders inside the message list. Most vLLM chat templates reject those, so the translator probes the template once at startup and either keeps them or folds them into the neighbouring user turn as `<system-reminder>` text.
- Adaptive thinking, `output_config.effort` and thinking blocks in history are mapped to the vLLM request fields that the detected version supports.
- vLLM never sends keep-alive events; the translator adds `ping` events so long prompt processing does not look like a dropped connection.
- A context overflow from vLLM is rewritten to Anthropic's "prompt is too long" wording, which triggers Claude Code's own auto-compaction.
- Tool schemas keep working; tool-call ids and long tool names are remapped as needed and mapped back.

## Troubleshooting

- `400 "auto" tool choice requires --enable-auto-tool-choice`: the vLLM flags in step 1 are missing.
- Claude Code warns about an unknown model: it assumes a 200k window for ids it does not recognize. Keep vLLM's `--max-model-len` in mind, since the translator reports the real limit through overflow errors.
- Check what was detected with `api.status()` (library) or the startup log, and see [server.md](server.md) for pings and auth.

## Tool search

By default Claude Code does not send every tool up front. It marks the tools it wants to defer with `defer_loading: true`, lists their names in a system reminder, adds a reserved `DeferredToolPlaceholder` tool ("never call this tool") that keeps the feature active, and gives the model a client tool, `ToolSearch`, whose query (`select:Name,Name` or keywords) returns the tools to load: as `tool_reference` blocks in the tool result and as `<function>{json}</function>` lines in its text. Anthropic's API expands the references into real tool definitions. An OpenAI-style server cannot, so the translator does it by changing the tools list of the next request. The captured traffic in `tests/fixtures/claude-code/` shows `ToolSearch` and the placeholder; the deferred tools' own definitions are either in `tools` with `defer_loading` or only in the `ToolSearch` result text, and the translator uses whichever it finds.

The `toolSearch` setting ([settings](settings.md)) chooses what happens:

| Value              | What the upstream sees                                                                                                                                                                                                                  | Use it when                                                                              |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `expand` (default) | The tools without `defer_loading`, `ToolSearch`, and every deferred tool the conversation has loaded. The placeholder is never sent. `[Tool loaded: <name>]` replaces each `tool_reference` in the result.                              | The model calls tools reliably. Costs one extra `ToolSearch` call per tool group.        |
| `inline`           | Every tool sent with a definition, deferred or not, and no `ToolSearch`. `ToolSearch` stays only if the placeholder shows that Claude Code holds tools whose definitions it did not send, because they would be unreachable without it. | Small models, or when the tools are few. Tools Claude Code never sent cannot be offered. |
| `native`           | Everything as sent: tools keep `defer_loading`, the placeholder stays, and a `tool_reference` becomes a `tool_reference` content part in the tool message.                                                                              | A server whose chat template renders them. No bundled driver enables it.                 |

**Expansion.** In `expand` mode the tools list is built as: the tools without `defer_loading` in request order, then the deferred tools loaded so far in the order they were first loaded, then tools defined only in a `ToolSearch` result's text. A tool counts as loaded when a `tool_reference` names it, when the assistant has already called it (so a conversation with a truncated history still works), when `tool_choice` forces it, or when a `ToolSearch` result defines it in a `<function>` line (only that tool's results are read, so the output of other tools cannot add tools). A reference to a tool the request does not define stays a plain `[Tool reference: <name>]` note. The list only grows at its end, so the prefix of an earlier request is a prefix of the next one, which keeps prompt caches valid. `ToolSearch` is hidden once every deferred tool in the request is loaded and the placeholder is absent. Tool names the model calls map back through the same name table as any other tool, which is filled in request order for every tool whether or not it is offered, so a name's wire form does not change between turns.

**Per model family.** Nothing here has been run against a real backend ([#65](https://github.com/CLDMV/llm-translator/issues/65)); the notes follow from what each mode needs.

- `expand` needs ordinary function calling and a model that decides to call `ToolSearch` first. That is plausible for models with solid tool use through their vLLM or llama.cpp parser (Qwen3 and Qwen3-Coder, GLM-4.5, Kimi K2, DeepSeek V3.x, Llama 3.x, Mistral Large) and unverified for any of them.
- Small models (the 1.7B Qwen3 used for the end-to-end runs never called a tool at all) will not search. Use `inline`, or `ENABLE_TOOL_SEARCH=false` in Claude Code, which sends every tool inline and no `ToolSearch`.
- `native` is for a server and chat template that show the referenced tool to the model. vLLM accepts `tool_reference` content parts in tool messages, but accepting a part does not mean the model's template renders the tool definition, so no bundled driver turns it on. A driver for such a server returns `{ toolSearch: "native" }` from its `settings()`, or set it per upstream in `settings`.
- The hosted OpenAI API driver sets `deferredTools: "drop"`: deferred tools and `ToolSearch` are removed.
