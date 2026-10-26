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

| Variable                                                         | Why                                                                                                                                                                                        |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `ANTHROPIC_BASE_URL`                                             | the translator's address                                                                                                                                                                   |
| `ANTHROPIC_AUTH_TOKEN`                                           | sent as `Authorization: Bearer`; any value works unless the translator was started with `--api-key`, in which case use that key (`ANTHROPIC_API_KEY` is sent as `x-api-key` and works too) |
| `ANTHROPIC_MODEL`, `ANTHROPIC_DEFAULT_{OPUS,SONNET,HAIKU}_MODEL` | model ids are sent verbatim; setting all of them avoids requests for model names the upstream does not serve (the alias flag is the alternative)                                           |
| `CLAUDE_CODE_MAX_OUTPUT_TOKENS`                                  | Claude Code asks for 32000 to 128000 output tokens by default; vLLM clamps oversized values, but a realistic cap keeps replies bounded                                                     |
| `ENABLE_TOOL_SEARCH=false`                                       | recommended for local models: Claude Code then sends every tool inline instead of loading tools on demand through `tool_reference` blocks, which small models handle poorly                |
| `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1`                     | skips the connection warm-up probe and other optional traffic                                                                                                                              |

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
