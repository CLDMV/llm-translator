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

### Latest: v0.2.0 (October 2026)

- **The translator** — six converters between the Anthropic Messages API and OpenAI Chat Completions (requests, responses and streams, both directions), backend detection with `vllm`, `openai`, `anthropic` and generic `compatible` drivers, model aliases and routing, and `createTranslator` with `request`, `response`, `stream`, `send`, `route` and `detect`. Text, images, PDFs, tools and reasoning are mapped; whatever has no counterpart is dropped, rejected or replaced by a note, never guessed.
- **Server and CLI for Claude Code** — an Anthropic or OpenAI front over Fastify (optional peer dependency) and the `llm-translator` command. Slow upstreams are supported: no transport timeouts, and early `message_start` plus keep-alive deltas satisfy Claude Code's stream watchdog during long prefills. Models that refuse images are detected at startup or on the first refusal and retried once without them.
- [View full v0.2.0 Changelog](https://github.com/CLDMV/llm-translator/blob/master/docs/changelog/v0/v0.2.0.md)

### Recent Releases

- **v0.1.0** (October 2026) — package scaffold: ESM and CommonJS entry points, tsup build, the `llm-translator-dev` condition with devcheck, tests on `@cldmv/vitest-runner` and the CLDMV v4 CI/release pipeline; the only export was a placeholder ([Changelog](https://github.com/CLDMV/llm-translator/blob/master/docs/changelog/v0/v0.1.0.md))

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

- Node.js 22.15 or newer
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
const { input_tokens, output_tokens, reported } = await reply.usage; // or send(body, { onUsage })
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

`createTranslator(config)` takes `front`, `upstreams` (URLs or objects with `url`, `apiKey`, `backend`, `models`, `default` and `settings`), `aliases`, global `settings`, `detect` and a custom `transport`. The CLI reads the same keys from flags, `LLM_TRANSLATOR_*` environment variables and a JSON file, in that order of precedence.

Settings tune how the converters map one protocol onto the other (`inlineSystem`, `images`, `imageFallback`, `toolStreaming`, `pingInterval` and more); they are resolved per upstream from defaults, probed values, driver defaults and your overrides. The full table is in [docs/settings.md](https://github.com/CLDMV/llm-translator/blob/master/docs/settings.md).

---

## 📚 Documentation

### Reference

- [Server and CLI](https://github.com/CLDMV/llm-translator/blob/master/docs/server.md)
- [Settings](https://github.com/CLDMV/llm-translator/blob/master/docs/settings.md)
- [Protocol support](https://github.com/CLDMV/llm-translator/blob/master/docs/protocol-support.md)
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
