/**
 * What is wrong with a constraint value, if anything.
 * @param {any} value - A `constraint` setting or request value.
 * @returns {string | null} A message, or null when the value is a valid constraint (or absent).
 */
export function check(value: any): string | null;
/**
 * The fields to add to a Chat Completions body for one constraint, or null when the backend cannot enforce that kind.
 * @param {string} driver - Driver name.
 * @param {string | undefined} version - Server version (vLLM), when known.
 * @param {string} kind - One of {@link KINDS}.
 * @param {any} value - The constraint's value.
 * @returns {Record<string, any> | null} Body fields, or null when unsupported.
 */
export function fields(driver: string, version: string | undefined, kind: string, value: any): Record<string, any> | null;
/**
 * Add a constraint to an OpenAI-protocol body in the backend's own fields. The request's constraint (`constraint` on the OpenAI front,
 * `metadata.constraint` on the Anthropic front) replaces the upstream's `constraint` setting. A body that already carries the native field
 * keeps it. vLLM applies a constraint to the whole generation, so with tools on offer the constraint is dropped and recorded (the tools win).
 * A kind the backend cannot enforce follows `unknownFields`: dropped (listed in `dropped`) or rejected.
 * @param {any} body - Converted or forwarded Chat Completions body.
 * @param {any} asked - The request's constraint, if any.
 * @param {any} settings - Resolved settings (`constraint`, `unknownFields`).
 * @param {{ name: string, version?: string }} target - The upstream's driver name and server version.
 * @param {string[]} [dropped] - Receives `constraint` names that were left out.
 * @returns {any} The body, with the fields added (a copy when anything was added).
 * @throws {TranslatorError} `invalid_request` for a malformed request constraint; `unsupported_field` when the backend cannot enforce the kind and `unknownFields` is `"error"`.
 */
export function addConstraint(body: any, asked: any, settings: any, target: {
    name: string;
    version?: string;
}, dropped?: string[]): any;
/** The constraint kinds a client can ask for. */
export const KINDS: string[];
/** First vLLM release whose Chat Completions endpoint takes `structured_outputs`; older releases take `guided_json`, `guided_regex`, `guided_choice` and `guided_grammar`. */
export const STRUCTURED_OUTPUTS_VERSION: "0.11.0";
