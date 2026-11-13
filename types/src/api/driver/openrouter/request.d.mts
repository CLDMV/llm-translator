/**
 * Drop empty tool fields and express the reasoning controls the way OpenRouter takes them: a `reasoning` object with either `effort` or
 * `max_tokens`, never both. A `reasoning` object the client sent itself is kept as it is (its `reasoning_effort` sibling is removed). Otherwise
 * `reasoning_effort` becomes `reasoning: { effort }`, and an Anthropic request that enabled thinking with a `budget_tokens` and no effort
 * becomes `reasoning: { max_tokens }`, capped below the request's `max_tokens`.
 * @param {any} body - Chat Completions request body.
 * @param {any} [context] - `{ state }`; `state.thinkingBudget` is the thinking budget of an Anthropic request.
 * @returns {any} Normalized body.
 */
export function request(body: any, context?: any): any;
