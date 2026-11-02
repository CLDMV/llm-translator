/**
 * Retrieve one entry of the model list (`model.list`) by id, in the client protocol's model shape (Anthropic `{type:"model",...}` or
 * OpenAI `{object:"model",...}`). Aliases are found like served models.
 * @param {string} id - Model id as the client sends it.
 * @param {any} [options] - `{ signal, front }`.
 * @returns {Promise<any>} Model object.
 * @throws {TranslatorError} `model_not_found` (HTTP 404) when no upstream serves the id and it is not an alias.
 */
export function get(id: string, options?: any): Promise<any>;
