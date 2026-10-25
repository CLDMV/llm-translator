# @cldmv/llm-translator

Bidirectional **Anthropic Messages ⇄ OpenAI Chat Completions** translator built on [slothlet](https://github.com/CLDMV/slothlet). It detects the backend behind an upstream (vLLM first, then any OpenAI-compatible server), converts requests, responses and streams in both directions, and ships an optional standalone server so Claude Code can run against local models.

## Install

```bash
npm install @cldmv/llm-translator
npm install fastify   # only for the server and the Fastify plugin
```

Node.js 22.15 or newer.

## Quick start: library

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
```

## Quick start: server

```bash
npx llm-translator --upstream http://gpu-box:8000 --port 8787
```

```js
const server = await api.server.start({ port: 8787 });
console.log(server.url);
```

Then point Claude Code at it with `ANTHROPIC_BASE_URL=http://127.0.0.1:8787`. The full walkthrough is in [docs/claude-code.md](docs/claude-code.md).

## Documentation

- [Claude Code against vLLM](docs/claude-code.md)
- [Server and CLI](docs/server.md)
- [Drivers, detection and routing](docs/drivers.md)
- [Protocol support](docs/protocol-support.md)
- [Settings](docs/settings.md)
- [Feature inventory](docs/feature-inventory.md)
- [Changelog](docs/changelog)

## ✨ What's New

### Latest: v0.1.0 (October 2026)

- **First release: the package scaffold** — ESM and CommonJS entry points, a tsup build, the `llm-translator-dev` condition with devcheck for working from source, tests on `@cldmv/vitest-runner`, and the CLDMV v4 CI/release pipeline. The only export so far is a placeholder `name`; the translation API comes next.
- [View full v0.1.0 Changelog](https://github.com/CLDMV/llm-translator/blob/master/docs/changelog/v0/v0.1.0.md)

## License

[Apache-2.0](LICENSE)
