/**
 * Walk a schema and list what falls outside the strict subset: an object schema must say `additionalProperties: false` and list every
 * property in `required`, and the keywords in `UNSUPPORTED` are not allowed anywhere.
 * @param {any} schema - A tool's JSON Schema.
 * @param {string} [at] - Path of `schema` within the tool's schema.
 * @param {string[]} [out] - Problems found so far.
 * @returns {string[]} One line per problem, each starting with its path (`$` is the schema's root).
 */
export function problems(schema: any, at?: string, out?: string[]): string[];
/**
 * The tools of an upstream body that ask for strict use, with the problems of their schemas. Reads both wire shapes: Chat Completions
 * (`function.strict`, `function.parameters`) and Anthropic Messages (`strict`, `input_schema`).
 * @param {any} body - Upstream request body.
 * @returns {{name: string, problems: string[]}[]} Strict tools in request order.
 */
export function strictTools(body: any): {
    name: string;
    problems: string[];
}[];
/**
 * Send the tools whose schema is outside the strict subset without `strict` (the key is removed, not set to false). Reads both wire shapes
 * like `strictTools`. Nothing in `body` is modified: tools that change are rebuilt, and the body is copied only when one did.
 * @param {any} body - Upstream request body.
 * @returns {any} `body` itself when every strict tool conforms, otherwise a copy with the rebuilt `tools`.
 */
export function relax(body: any): any;
