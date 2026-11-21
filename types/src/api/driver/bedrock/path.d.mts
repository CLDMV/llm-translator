/**
 * Build the path of a call: the model id (percent-encoded as one segment) and the operation. InvokeModel is `/invoke`, or
 * `/invoke-with-response-stream` for a stream; Converse is `/converse`, or `/converse-stream`.
 * @param {"messages" | "converse"} kind - Which call: `messages` is InvokeModel with an Anthropic body.
 * @param {any} context - `{ endpoint, model, stream }`.
 * @returns {string} Path starting with `/model/`.
 * @throws {TranslatorError} `unsupported_endpoint` (501) for any other call (embeddings, chat).
 */
export function path(kind: "messages" | "converse", { model, stream }: any): string;
