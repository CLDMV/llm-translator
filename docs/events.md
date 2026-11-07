# Events and logging

Everything the library would log is also an event the application can subscribe to, so it can log it, count it or react to it. Events and logging are separate switches: events are on by default, logging is off by default, so the library is quiet unless it is asked to write logs.

## Subscribing

```js
import { createTranslator } from "@cldmv/llm-translator";

const translator = await createTranslator({
	upstreams: ["http://gpu-box:8000"],
	// One callback registered before startup, so it also sees the startup events (the PDF libraries and the detection run before createTranslator returns).
	onEvent: (event) => metrics.count(event.type)
});

const stop = translator.events.on("fallback", (event) => console.log(event.endpoint, event.status, event.reason));
translator.events.on("*", (event) => audit.write(event));
stop(); // or translator.events.off("fallback", listener)
```

- `translator.events.on(name, fn)` returns a function that removes the listener. `translator.events.off(name, fn)` removes it by reference and ignores a listener that is not subscribed.
- `"*"` receives every occurrence once (not once per general event it also fires).
- `onEvent` is a single callback in the config. It is registered as a `"*"` listener before anything else runs.
- `events: false` in the config turns emitting off entirely: no listener is called, `onEvent` included. Logging does not depend on it.
- Events fire on every occurrence. Only the console output is once per message.
- Listeners only observe. One that throws, or returns a promise that rejects, is caught and can never affect a request. The failure is reported once through logging (when logging is on), and never as an event, so it cannot loop.

## What an event looks like

Every event has the same payload shape, whichever listener receives it:

```js
{ type, kind?, level, message, time, ...details }
```

| Field     | Meaning                                                                        |
| --------- | ------------------------------------------------------------------------------ |
| `type`    | The specific event name (see the catalogue).                                   |
| `kind`    | Optional sub-kind within the type, for example `json_object` for a `fallback`. |
| `level`   | `"debug"`, `"info"`, `"warn"` or `"error"`.                                    |
| `message` | Human readable text. This is what the console prints.                          |
| `time`    | Milliseconds since the epoch (`Date.now()`).                                   |
| details   | Fields specific to the event, listed below.                                    |

One occurrence fires its specific event first, then the general events that fit, then `"*"`, all with the same payload object:

- `log` fires for everything.
- `warning` fires for every event with level `warn`.
- `error` fires for every event with level `error`.

A json_object fallback, for instance, fires `fallback`, then `warning`, then `log`, then `"*"`:

```js
{
	type: "fallback", kind: "json_object", level: "warn",
	message: 'Upstream local: qwen3 rejected the json_object schema emulation (400: "..."); sent it as a system instruction instead. ...',
	time: 1730000000000,
	endpoint: "local", model: "qwen3", status: 400, reason: "<upstream text>", action: "instruction"
}
```

## Catalogue

General events:

| Event     | Fires for                                                                                                                     |
| --------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `log`     | Every event, whatever its level.                                                                                              |
| `warning` | Every event with level `warn`: everything that printed a console warning before, plus the new warnings.                       |
| `error`   | Real failures only: a caught exception, an upstream 5xx, a transport error, a body that is not JSON, or a server route error. |

Specific events (each also fires the general ones that fit its level):

| Event      | Kind                                          | Level | Details                                                            | When                                                                                                                                                                                                                                                                                                                                         |
| ---------- | --------------------------------------------- | ----- | ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fallback` | `images`                                      | warn  | `endpoint`, `model`, `status`, `reason`, `action: "text-only"`     | An OpenAI-protocol upstream refused images and the request was sent again without them. `reason` is the upstream's own message.                                                                                                                                                                                                              |
| `fallback` | `tools`                                       | warn  | `endpoint`, `model`, `status`, `reason`, `action: "without-tools"` | The upstream refused tool calling (a vLLM without a tool parser) and `toolFallback` sent the request again without tools.                                                                                                                                                                                                                    |
| `fallback` | `json_object`                                 | warn  | `endpoint`, `model`, `status`, `reason`, `action: "instruction"`   | An Anthropic-protocol upstream refused the schema that stands in for `json_object`, and the request worked as a system instruction. Fires once the retry worked.                                                                                                                                                                             |
| `failover` |                                               | warn  | `from`, `to`, `model`, `reason`                                    | A pool member failed (a 5xx or a connection error) and the request moves to the next one.                                                                                                                                                                                                                                                    |
| `effort`   |                                               | warn  | `endpoint`, `model`, `requested`, `used`, `levels`                 | A reasoning effort was snapped to the nearest level the model lists (see [settings.md](settings.md)).                                                                                                                                                                                                                                        |
| `dropped`  |                                               | debug | `endpoint`, `model`, `fields`                                      | Fields the conversion or the driver left out. One per upstream request; a retry of the same request does not repeat it.                                                                                                                                                                                                                      |
| `detect`   | `driver`                                      | info  | `endpoint`, `url`, `driver`                                        | An upstream was bound to a driver.                                                                                                                                                                                                                                                                                                           |
| `detect`   | `unreachable`                                 | warn  | `endpoint`, `url`, `driver`                                        | The upstream did not answer detection and the generic driver was bound.                                                                                                                                                                                                                                                                      |
| `detect`   | `canvas`, `unpdf`                             | warn  | `reason`                                                           | A PDF library could not be loaded at startup.                                                                                                                                                                                                                                                                                                |
| `usage`    | `threw`, `rejected`                           | warn  |                                                                    | The `onUsage` callback threw or rejected. The reply is not affected.                                                                                                                                                                                                                                                                         |
| `warning`  | `toolsearch`, `reasoning`, `strict`, `driver` | warn  | `endpoint`                                                         | A warning with no specific event: more tool definitions than the cap came back in ToolSearch results, assistant turns with tool calls have no reasoning to send back, a strict tool whose schema is outside the strict subset or whose backend does not enforce strict use, or a driver's own warning (for example Ollama's context window). |
| `error`    | `upstream`                                    | error | `endpoint`, `model`, `status`                                      | The upstream answered with a 5xx (or a body that is not JSON, reported as 502).                                                                                                                                                                                                                                                              |
| `error`    | `transport`                                   | error | `endpoint`, `model`                                                | The upstream could not be reached or timed out.                                                                                                                                                                                                                                                                                              |
| `error`    | `exception`                                   | error |                                                                    | An exception that is not a translator error escaped `send`. An abort by the caller is not reported.                                                                                                                                                                                                                                          |
| `error`    | `route`                                       | error | `status` (for the error handler)                                   | The server hit an unexpected error: a route error, an `authorize` hook that threw, or a stream that broke after it was committed.                                                                                                                                                                                                            |

An upstream 5xx that is followed by a failover fires an `error` for the failure and a `failover` for the move.

## Logging

`logs` controls what the library writes. It replaces `silent`.

| Value             | Effect                                                                                                                                                                                                                                                                                                                                                                   |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `false` (default) | No console output and no file.                                                                                                                                                                                                                                                                                                                                           |
| `true`            | Warnings and errors go to the console as `[llm-translator] <message>`, once per message.                                                                                                                                                                                                                                                                                 |
| `"<path>"`        | Every event, at every level, is appended to the file as one JSON object per line. A relative path resolves against `process.cwd()`, and a missing directory is created. If the file cannot be opened, one notice is printed on the console and logging is off; `createTranslator` never throws for it. A write that fails later is reported once and file logging stops. |

Logging is fed from the same internal path as the events, so turning `events` off does not turn logging off, and whatever is logged can also be observed.

`silent: true` is still accepted as an alias for `logs: false`, which is the default now. It is deprecated; use `logs`. If both are given, `logs` wins.

The CLI defaults to `logs: true` so a server still shows its warnings, and `--logs [path]` and `--silent` change that (see [server.md](server.md)).

In server mode, when the Fastify `logger` is enabled, events also go to it as structured lines: `{ event }` plus the message, at the event's level. A request's events use that request's logger (so they carry its request id), and everything else uses the app logger. The existing `request.log.error` calls for unexpected route errors stay as they are, and the matching `error` event is not logged to Fastify a second time.

## Upgrade note

Warnings no longer print by default. An application that relied on the console warnings should pass `logs: true`, or subscribe to `warning`.
