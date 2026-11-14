# @cldmv/llm-translator

Bidirectional **Anthropic Messages ⇄ OpenAI Chat Completions** translator built on [slothlet](https://github.com/CLDMV/slothlet). It detects the backend behind an upstream (vLLM first, then any OpenAI-compatible server), converts requests, responses and streams in both directions, and ships an optional standalone server and CLI so Claude Code can run against local models.

Use it as a library when you want the conversion without any I/O (`request`, `response` and `stream` take plain objects), as a full round trip (`send`), or as a server that speaks the Anthropic or the OpenAI protocol to your clients.

> _Point Claude Code at a model running on your own GPU._

[![npm version]][npm_version_url] [![npm downloads]][npm_downloads_url] [![GitHub downloads]][github_downloads_url] [![Last commit]][last_commit_url] [![npm last update]][npm_last_update_url] [![coverage]][coverage_url]

> [!NOTE]
> **Status: 0.x.** Validated end to end for Claude Code (print mode) through the translator to vLLM. Other backends, model families and clients are covered by unit tests only and are tracked in the [Real-backend validation epic](https://github.com/CLDMV/llm-translator/issues/62). The API may change between minor versions.

[![Contributors]][contributors_url] [![Sponsor shinrai]][sponsor_url]

---

## ✨ What's New

### Latest: v0.10.0 (November 2026)

- **Native `/v1/messages` for vLLM** — set `nativeMessages` (`true` or `"auto"`) and Anthropic requests go to vLLM's own endpoint with only normalisation. Prefills, document blocks and deferred tools are still converted, and an upstream without the route falls back to conversion.
- **Readiness probes and LoRA adapters** — pools check vLLM's `/health` and try ready upstreams first (`pool.healthInterval`, `pool.healthTimeout`, a `health` event, `health.check()`). Adapters are routable and carry `parent` in model lists.
- **Hosted provider drivers** — Groq, Together, Fireworks, xAI and Gemini are bound by host name, with their token fields, reasoning fields and rejected request fields handled from one table.
- **Ollama's native `/api/chat`** — set `api: "native"` on an Ollama upstream to use `think`, `options` and `format`, with NDJSON streaming converted for both fronts.
- [View full v0.10.0 Changelog](https://github.com/CLDMV/llm-translator/blob/master/docs/changelog/v0/v0.10.0.md)

### Recent Releases

- **v0.9.0** (November 2026) — Azure OpenAI, OpenRouter, Hugging Face TGI and LocalAI drivers, with Azure's `apiVersion` and `deployment` upstream fields and more startup probes ([Changelog](https://github.com/CLDMV/llm-translator/blob/master/docs/changelog/v0/v0.9.0.md))
- **v0.8.0** (November 2026) — Mistral and LM Studio drivers, an OpenAI client's `n` above 1 answered by parallel requests to Anthropic-protocol upstreams, and `stop_details.category` from content-filter results ([Changelog](https://github.com/CLDMV/llm-translator/blob/master/docs/changelog/v0/v0.8.0.md))
- **v0.7.0** (November 2026) — Anthropic-protocol servers detected by probe on any host, tool-call ids rewritten for strict upstream formats, embeddings usage through `onUsage`, and capture records for every failed-over attempt ([Changelog](https://github.com/CLDMV/llm-translator/blob/master/docs/changelog/v0/v0.7.0.md))
- **v0.6.0** (November 2026) — `POST /v1/embeddings` pass-through, sampling extensions per upstream and per request, `strict` tool use end to end with a schema check, and the `capture` option for debugging ([Changelog](https://github.com/CLDMV/llm-translator/blob/master/docs/changelog/v0/v0.6.0.md))

📚 **For complete version history and detailed release notes, see the [docs/changelog/](https://github.com/CLDMV/llm-translator/tree/master/docs/changelog/) folder.**

---

## 🚀 Key Features

### 🔁 **Both Directions**

Anthropic clients (Claude Code, the Anthropic SDKs) talk to OpenAI-compatible servers, and OpenAI clients talk to Anthropic upstreams. Requests, responses, streams, tool calls, usage, stop reasons and errors are converted; same-protocol traffic is forwarded without conversion.

### 🔎 **Backend Detection**

Each upstream is probed once and bound to a driver. The vLLM driver maps the server version to the right settings, checks whether the chat template accepts mid-conversation system messages and whether the model accepts images. See [docs/drivers.md](https://github.com/CLDMV/llm-translator/blob/master/docs/drivers.md).

### 🧠 **Reasoning and Tools**

Anthropic `thinking` maps to the server's reasoning request and reasoning comes back as thinking blocks. Tool calls are buffered into whole `tool_use` blocks by default, with an incremental mode available.

### 📄 **Images and PDFs**

Image blocks are converted, PDFs become per-page text plus page images when the model accepts them, and a text-only model is handled by a startup probe and a one-time retry without images.

### 🖥 **Server and CLI**

`llm-translator --upstream http://gpu-box:8000` starts a server with API-key protection for non-loopback binds, a client-header allow-list, and in-band error delivery for streams that are already committed. See [docs/server.md](https://github.com/CLDMV/llm-translator/blob/master/docs/server.md).

### 🛡 **100% Test Coverage**

Lines, statements, functions and branches are all at 100% and enforced on every CI run, with no coverage-ignore pragmas. A harness in `tools/e2e/` drives a real vLLM and a real Claude Code; see [docs/testing.md](https://github.com/CLDMV/llm-translator/blob/master/docs/testing.md).

---

## 📦 Installation

### Requirements

- Node.js 22.15 or newer. Node.js 26 is fastest: PDF.js (through `unpdf`) uses newer built-ins such as `Promise.try`, `Float16Array` and `Map.prototype.getOrInsert`, which Node.js 22 and 24 run through PDF.js' own polyfills. npm warns on Node.js 22 because `unpdf` 2 declares Node.js 24; text extraction and page rendering work on 22.15.
- Developing the package needs Node.js 22.22 or newer (`devEngines` enforces it on install and `npm run`)
- Fastify 5, only for the server and the Fastify plugin (an optional peer dependency)

### Install

```bash
npm install @cldmv/llm-translator
npm install fastify   # only for the server and the Fastify plugin
```

---

## 🚀 Quick Start

### Library

```js
import { createTranslator } from "@cldmv/llm-translator";

const api = await createTranslator({
	front: "anthropic", // the protocol your client speaks
	upstreams: ["http://gpu-box:8000"], // vLLM is detected automatically
	aliases: { "claude-opus-5-5": "qwen3-coder" }
});

// Pure conversion, no I/O: build the upstream call yourself.
const call = await api.request({ model: "claude-opus-5-5", max_tokens: 256, messages: [{ role: "user", content: "hi" }] });
// call.url, call.headers, call.body ...
// api.response(upstreamJson, call.state) converts a reply back,
// api.stream(upstreamSseBody, call.state) turns a stream into Anthropic events.

// Or let the translator do the full round trip.
const reply = await api.send({ model: "qwen3-coder", max_tokens: 256, stream: true, messages: [{ role: "user", content: "hi" }] });
if (reply.stream) for await (const { event, data } of reply.stream) console.log(event, data);

// Where would a request go, and what did it cost? (see docs/server.md)
const { upstream, model } = api.route({ model: "claude-opus-5-5" }); // no I/O
const { input_tokens, output_tokens, reported, estimated } = await reply.usage; // or send(body, { onUsage }); `estimated` holds the guesses written into the client reply when the upstream sent no usage

// Fallbacks, failovers and warnings are events (see docs/events.md); logging is off unless you set `logs`.
const stop = api.events.on("fallback", ({ endpoint, status, reason }) => console.log(endpoint, status, reason));
```

### Server and Claude Code

```bash
npx llm-translator --upstream http://gpu-box:8000 --port 8787 --model claude-opus-5-5=qwen3-coder
```

```js
const server = await api.server.start({ port: 8787 });
console.log(server.url);
```

Then point Claude Code at it with `ANTHROPIC_BASE_URL=http://127.0.0.1:8787`. The full walkthrough, including the vLLM flags tool calling needs, is in [docs/claude-code.md](https://github.com/CLDMV/llm-translator/blob/master/docs/claude-code.md).

---

## 📚 Configuration

`createTranslator(config)` takes `front`, `upstreams` (URLs or objects with `url`, `apiKey`, `backend`, `models`, `default` and `settings`, plus `apiVersion` and `deployment` for Azure OpenAI, see [docs/drivers.md](https://github.com/CLDMV/llm-translator/blob/master/docs/drivers.md#azure-openai), and `api: "native"` for Ollama's own `/api/chat`, see [docs/drivers.md](https://github.com/CLDMV/llm-translator/blob/master/docs/drivers.md#native-apichat-mode)), `aliases` (a model name, or `{ model, effort, thinking }` to pin settings), `efforts` (the reasoning levels each model supports, see [docs/settings.md](https://github.com/CLDMV/llm-translator/blob/master/docs/settings.md#effort-levels-and-pinned-aliases-not-converter-settings)), global `settings`, `pool` (failover and load balancing between upstreams that serve the same model, see [docs/server.md](https://github.com/CLDMV/llm-translator/blob/master/docs/server.md#endpoint-pools-failover-and-load-balancing)), `detect`, `logs` (off by default; `true` prints warnings, a path appends JSON lines), `events` and `onEvent` (see [docs/events.md](https://github.com/CLDMV/llm-translator/blob/master/docs/events.md)), `capture` (off by default; a directory or a callback receives redacted request and response records for debugging, see [docs/events.md](https://github.com/CLDMV/llm-translator/blob/master/docs/events.md#capture-for-debugging)) and a custom `transport`. `silent: true` is a deprecated alias for `logs: false`. The CLI reads the same keys from flags, `LLM_TRANSLATOR_*` environment variables and a JSON file, in that order of precedence.

Settings tune how the converters map one protocol onto the other (`inlineSystem`, `images`, `imageFallback`, `toolStreaming`, `pingInterval` and more); they are resolved per upstream from defaults, probed values, driver defaults and your overrides. The full table is in [docs/settings.md](https://github.com/CLDMV/llm-translator/blob/master/docs/settings.md).

---

## 📚 Documentation

### Reference

- [Server and CLI](https://github.com/CLDMV/llm-translator/blob/master/docs/server.md)
- [Settings](https://github.com/CLDMV/llm-translator/blob/master/docs/settings.md)
- [Protocol support](https://github.com/CLDMV/llm-translator/blob/master/docs/protocol-support.md)
- [Events and logging](https://github.com/CLDMV/llm-translator/blob/master/docs/events.md)
- [Drivers, detection and routing](https://github.com/CLDMV/llm-translator/blob/master/docs/drivers.md)

### Guides

- [Claude Code against vLLM](https://github.com/CLDMV/llm-translator/blob/master/docs/claude-code.md)
- [Testing and the real-backend harness](https://github.com/CLDMV/llm-translator/blob/master/docs/testing.md)
- [Known limitations](https://github.com/CLDMV/llm-translator/blob/master/docs/known-limitations.md)
- [Feature inventory](https://github.com/CLDMV/llm-translator/blob/master/docs/feature-inventory.md)
- [Design decisions](https://github.com/CLDMV/llm-translator/blob/master/docs/decisions.md)

### Repo

[![npm unpacked size]][npm_size_url] [![Repo size]][repo_size_url]

---

## 🔗 Links

- **npm**: [@cldmv/llm-translator](https://www.npmjs.com/package/@cldmv/llm-translator)
- **GitHub**: [CLDMV/llm-translator](https://github.com/CLDMV/llm-translator)
- **Issues**: [GitHub Issues](https://github.com/CLDMV/llm-translator/issues)
- **Releases**: [GitHub Releases](https://github.com/CLDMV/llm-translator/releases)

---

## 📄 License

[![GitHub license]][github_license_url] [![npm license]][npm_license_url]

Apache-2.0 © Shinrai / CLDMV

[npm version]: https://img.shields.io/npm/v/%40cldmv%2Fllm-translator.svg?style=for-the-badge&logo=npm&logoColor=white&labelColor=CB3837
[npm_version_url]: https://www.npmjs.com/package/@cldmv/llm-translator
[npm downloads]: https://img.shields.io/npm/dm/%40cldmv%2Fllm-translator.svg?style=for-the-badge&logo=npm&logoColor=white&labelColor=CB3837
[npm_downloads_url]: https://www.npmjs.com/package/@cldmv/llm-translator
[github downloads]: https://img.shields.io/github/downloads/CLDMV/llm-translator/total?style=for-the-badge&logo=github&logoColor=white&labelColor=181717
[github_downloads_url]: https://github.com/CLDMV/llm-translator/releases
[last commit]: https://img.shields.io/github/last-commit/CLDMV/llm-translator?style=for-the-badge&logo=github&logoColor=white&labelColor=181717
[last_commit_url]: https://github.com/CLDMV/llm-translator/commits
[npm last update]: https://img.shields.io/npm/last-update/%40cldmv%2Fllm-translator?style=for-the-badge&logo=npm&logoColor=white&labelColor=CB3837
[npm_last_update_url]: https://www.npmjs.com/package/@cldmv/llm-translator
[npm unpacked size]: https://img.shields.io/npm/unpacked-size/%40cldmv%2Fllm-translator.svg?style=for-the-badge&logo=npm&logoColor=white&labelColor=CB3837
[npm_size_url]: https://www.npmjs.com/package/@cldmv/llm-translator
[repo size]: https://img.shields.io/github/repo-size/CLDMV/llm-translator?style=for-the-badge&logo=github&logoColor=white&labelColor=181717
[repo_size_url]: https://github.com/CLDMV/llm-translator
[github license]: https://img.shields.io/github/license/CLDMV/llm-translator.svg?style=for-the-badge&logo=github&logoColor=white&labelColor=181717
[github_license_url]: https://github.com/CLDMV/llm-translator/blob/HEAD/LICENSE
[npm license]: https://img.shields.io/npm/l/%40cldmv%2Fllm-translator.svg?style=for-the-badge&logo=npm&logoColor=white&labelColor=CB3837
[npm_license_url]: https://www.npmjs.com/package/@cldmv/llm-translator
[coverage]: https://img.shields.io/endpoint?url=https%3A%2F%2Fraw.githubusercontent.com%2FCLDMV%2Fllm-translator%2Fbadges%2Fcoverage.json&style=for-the-badge&logo=vitest&logoColor=white
[coverage_url]: https://github.com/CLDMV/llm-translator/blob/badges/coverage.json
[contributors]: https://img.shields.io/github/contributors/CLDMV/llm-translator.svg?style=for-the-badge&logo=github&logoColor=white&labelColor=181717
[contributors_url]: https://github.com/CLDMV/llm-translator/graphs/contributors
[sponsor shinrai]: https://img.shields.io/github/sponsors/shinrai?style=for-the-badge&logo=githubsponsors&logoColor=white&labelColor=EA4AAA&label=Sponsor
[sponsor_url]: https://github.com/sponsors/shinrai
