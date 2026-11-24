/**
 * Convert an Anthropic Messages request body into an OpenAI Chat Completions request body.
 *
 * Returns the converted body plus a JSON-serializable `state` the response/stream converters need (original model,
 * tool-name map, thinking mode, fields that were dropped).
 * @param {any} body - Anthropic `POST /v1/messages` body.
 * @param {Partial<import("../../../../../../../lib/settings.mjs").Settings>} [settings] - Translator settings.
 * @param {{ producer?: string, budget?: ReturnType<typeof createBudget>, listed?: boolean, toolCallIds?: { alphabet: string, min?: number, max?: number }, sources?: boolean, cachePoints?: boolean }} [context] - `cachePoints` keeps the `cache_control` markers of tools, system blocks, content blocks and the request as `cache_point` markers (`{ ttl? }`) on the converted tools, on the parts of the system, user and assistant messages and tool calls (each marker follows the block it was on), and on the last message for the request's own, for a converter that sends them as cache points of its own (Amazon Bedrock's Converse); no other converter asks for it, because a marker has no place in a Chat Completions body. `sources` keeps the parts made from `document` and `search_result` blocks as separate parts tagged with their source (see `lib/citations.mjs`), for a converter that sends them as documents of their own. `toolCallIds` is the driver's tool-call id policy: ids that do not satisfy it are rewritten (and recorded in `state.toolIds` for the way back). `producer` is the `driver:protocol:host` the request goes to; signatures that carry provider reasoning data are restored only for the producer that made them. `budget` limits how much signature decoding the request may cost (one is made when absent; `send` passes one for all its attempts). `listed` says the model has a configured effort list, so the default `medium` effort is left to it.
 * @returns {Promise<{ body: any, state: any }>} OpenAI request body and conversion state.
 * @throws {TranslatorError} For malformed requests, unsupported content when configured to error, or PDF limit violations.
 */
export function request(body: any, settings?: Partial<import("../../../../../../../lib/settings.mjs").Settings>, context?: {
    producer?: string;
    budget?: ReturnType<typeof createBudget>;
    listed?: boolean;
    toolCallIds?: {
        alphabet: string;
        min?: number;
        max?: number;
    };
    sources?: boolean;
    cachePoints?: boolean;
}): Promise<{
    body: any;
    state: any;
}>;
import { createBudget } from "../../../../../../../lib/thinking.mjs";
