/**
 * Validate and normalize the `efforts` config: model name to a list of levels, or `{ levels, default }`.
 * @param {any} [raw] - Raw `efforts` value.
 * @returns {Record<string, EffortConfig>} Normalized map.
 * @throws {TranslatorError} `INVALID_CONFIG` for an unknown level, an empty list or a default that is not in the list.
 */
export function normalizeEfforts(raw?: any): Record<string, EffortConfig>;
/**
 * Split the `aliases` config into the plain name map and the pinned settings. An alias is a model name or `{ model, effort, thinking }`.
 * @param {any} [raw] - Raw `aliases` value.
 * @returns {{aliases: Record<string, string>, pins: Record<string, {effort?: string, thinking?: boolean}>}} Name map and pins.
 * @throws {TranslatorError} `INVALID_CONFIG` for an object alias without a `model`, an unknown `effort` or a non-boolean `thinking`.
 */
export function normalizeAliases(raw?: any): {
    aliases: Record<string, string>;
    pins: Record<string, {
        effort?: string;
        thinking?: boolean;
    }>;
};
/**
 * The supported level nearest to a wanted one on the scale; a tie goes to the higher level.
 * @param {string[]} levels - Supported levels.
 * @param {string} wanted - A level from {@link LEVELS}.
 * @returns {string} Supported level.
 */
export function nearest(levels: string[], wanted: string): string;
/**
 * The level sent when a request names none.
 * @param {EffortConfig} entry - Model's effort config.
 * @returns {string | null} Level, or null to send none.
 */
export function defaultOf(entry: EffortConfig): string | null;
/**
 * Apply an alias's pinned settings to the client body (in the front protocol), before it is converted.
 * @param {any} body - Client body.
 * @param {{effort?: string, thinking?: boolean}} pin - Pinned settings.
 * @param {"anthropic" | "openai"} front - Client protocol.
 * @returns {any} New body.
 */
export function pinBody(body: any, pin: {
    effort?: string;
    thinking?: boolean;
}, front: "anthropic" | "openai"): any;
/**
 * Fit the `reasoning_effort` of an OpenAI Chat Completions body to a model's levels. A level in the list is kept, another one snaps to the
 * nearest (the message is passed to `warn`), a request with no effort gets the model's default, and a request that turns reasoning off is left alone.
 * @param {any} body - Upstream body (mutated).
 * @param {EffortConfig} entry - Model's effort config.
 * @param {string} model - Model name, for the message.
 * @param {(message: string) => void} warn - Warning sink.
 */
export function fit(body: any, entry: EffortConfig, model: string, warn: (message: string) => void): void;
/** The effort levels a model can be configured with, lowest to highest. `none` is not one: it switches reasoning off and is never snapped. */
export const LEVELS: readonly string[];
export type EffortConfig = {
    /**
     * - Supported levels, lowest to highest.
     */
    levels: string[];
    /**
     * - Level sent when the request names none; `null` sends nothing (the model has its own default); `undefined` picks the level nearest to `medium`.
     */
    default: string | null | undefined;
};
