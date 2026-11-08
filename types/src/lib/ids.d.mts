/**
 * Anthropic style message id.
 * @returns {string} `msg_...` id.
 */
export function messageId(): string;
/**
 * Anthropic style tool-use id.
 * @returns {string} `toolu_...` id.
 */
export function toolUseId(): string;
/**
 * OpenAI style completion id.
 * @returns {string} `chatcmpl-...` id.
 */
export function completionId(): string;
/**
 * OpenAI style tool-call id, for upstream tool calls that carry none.
 * @returns {string} `call_...` id.
 */
export function callId(): string;
/**
 * Make a tool-call id valid for Anthropic (`[a-zA-Z0-9_-]+`). An id found in `map` (`fitted -> original`, from a driver's `toolCallIds`
 * policy) is the client's own and is restored first. Otherwise valid ids pass through unchanged, invalid characters
 * (for example kimi's `functions.name:0`) become `_`, and a missing or empty id is replaced by a fresh one. The
 * mapping is deterministic so a tool call and its later tool result agree.
 * @param {unknown} id - Upstream id.
 * @param {Record<string, string>} [map] - `fitted -> original` ids from the conversion state.
 * @returns {string} Anthropic-valid id.
 */
export function anthropicToolId(id: unknown, map?: Record<string, string>): string;
/**
 * Whether a driver's `info().toolCallIds` is usable: `{ alphabet, min?, max? }` where `alphabet` is the body of a regular
 * expression character class that allows at least one printable ASCII character (`"a-zA-Z0-9"`), and `min` and `max` are
 * positive integers (`min <= max`) bounding the id length. Mistral's ids are `{ alphabet: "a-zA-Z0-9", min: 9, max: 9 }`.
 * @param {unknown} policy - Value to check.
 * @returns {boolean} True when the policy can be applied.
 */
export function validToolIdPolicy(policy: unknown): boolean;
/**
 * Create a tool-call id fitter for an upstream with a strict id format (`info().toolCallIds`, see `validToolIdPolicy`). The translator
 * keeps no state between requests, so the mapping is a pure function of the request: an id that already satisfies the policy passes
 * through unchanged (so history replayed from the upstream's own ids survives), and any other id becomes a hash of itself in the
 * allowed alphabet, the same text on every request. A tool call and its tool result carry the same original and so get the same
 * value. `ids` lists every original id of the request: the conforming ones are reserved first, then each other one takes its hash,
 * and when that text is already taken by a different original the hash is taken again with a counter until it is free. Every
 * rewritten id is recorded in `map` (`fitted -> original`) so the original can be restored when the upstream echoes it back.
 * @param {{ policy: { alphabet: string, min?: number, max?: number }, ids: unknown[], map?: Record<string, string> }} options - Policy, the request's ids and the (JSON-serializable) map to record into.
 * @returns {(id: unknown) => string} Fitter function.
 */
export function createIdFitter({ policy, ids, map }: {
    policy: {
        alphabet: string;
        min?: number;
        max?: number;
    };
    ids: unknown[];
    map?: Record<string, string>;
}): (id: unknown) => string;
/**
 * Original tool-call id for one rewritten by `createIdFitter` (ids that were never rewritten, including ones the upstream made itself,
 * map to themselves).
 * @param {Record<string, string>} map - `fitted -> original` map from the conversion state.
 * @param {string} id - Id seen on the wire.
 * @returns {string} Original id.
 */
export function restoreId(map: Record<string, string>, id: string): string;
/**
 * Create a tool-name fitter. Names that already satisfy `pattern` and `max` pass through; others are sanitized and,
 * when too long, shortened with a hash suffix. Every changed name is recorded in `map` (`fitted -> original`) so the
 * original can be restored on the way back. Fitted names are kept unique.
 * @param {{ max: number, map?: Record<string, string> }} options - Maximum length and the (JSON-serializable) map to record into.
 * @returns {(name: string) => string} Fitter function.
 */
export function createNameFitter({ max, map }: {
    max: number;
    map?: Record<string, string>;
}): (name: string) => string;
/**
 * Original tool name for a fitted one (names that were never changed map to themselves).
 * @param {Record<string, string>} map - `fitted -> original` map from the conversion state.
 * @param {string} name - Name seen on the wire.
 * @returns {string} Original name.
 */
export function restoreName(map: Record<string, string>, name: string): string;
