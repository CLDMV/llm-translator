/**
 * Check the `responses.prompts` setting: an object that maps a prompt id to one prompt (`{ instructions?, input? }`, at least one of them) or to a
 * map of versions, each a prompt.
 * @param {any} value - The setting.
 * @returns {Record<string, any>} The setting.
 * @throws {TranslatorError} `invalid_setting`.
 */
export function normalize(value: any): Record<string, any>;
/**
 * Find the prompt a request asks for and check its variables.
 * @param {Record<string, any>} prompts - The `responses.prompts` setting.
 * @param {any} reference - The request's `prompt`.
 * @returns {{ id: string, version: string | null, variables: Record<string, any>, prompt: { instructions?: string, input?: string | any[] } }} The prompt and what to echo.
 * @throws {TranslatorError} 400 with param `prompt` for a malformed reference, an unknown id or version, or bad variables.
 */
export function lookup(prompts: Record<string, any>, reference: any): {
    id: string;
    version: string | null;
    variables: Record<string, any>;
    prompt: {
        instructions?: string;
        input?: string | any[];
    };
};
/**
 * Fill in a prompt's variables.
 * @param {{ instructions?: string, input?: string | any[] }} prompt - The prompt.
 * @param {Record<string, any>} variables - Values by name: strings, or content parts.
 * @returns {{ instructions: string | null, items: any[] }} The prompt's instructions (null when it has none) and its input as items.
 * @throws {TranslatorError} 400 with param `prompt` for a variable that is not given, or a content part used inside other text.
 */
export function apply(prompt: {
    instructions?: string;
    input?: string | any[];
}, variables: Record<string, any>): {
    instructions: string | null;
    items: any[];
};
