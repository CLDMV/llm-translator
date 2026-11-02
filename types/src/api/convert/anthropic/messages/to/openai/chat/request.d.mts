/**
 * Convert an Anthropic Messages request body into an OpenAI Chat Completions request body.
 *
 * Returns the converted body plus a JSON-serializable `state` the response/stream converters need (original model,
 * tool-name map, thinking mode, fields that were dropped).
 * @param {any} body - Anthropic `POST /v1/messages` body.
 * @param {Partial<import("../../../../../../../lib/settings.mjs").Settings>} [settings] - Translator settings.
 * @param {{ producer?: string, budget?: ReturnType<typeof createBudget> }} [context] - `producer` is the `driver:protocol:host` the request goes to; signatures that carry provider reasoning data are restored only for the producer that made them. `budget` limits how much signature decoding the request may cost (one is made when absent; `send` passes one for all its attempts).
 * @returns {Promise<{ body: any, state: any }>} OpenAI request body and conversion state.
 * @throws {TranslatorError} For malformed requests, unsupported content when configured to error, or PDF limit violations.
 */
export function request(body: any, settings?: Partial<import("../../../../../../../lib/settings.mjs").Settings>, context?: {
    producer?: string;
    budget?: ReturnType<typeof createBudget>;
}): Promise<{
    body: any;
    state: any;
}>;
import { createBudget } from "../../../../../../../lib/thinking.mjs";
