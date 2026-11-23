/**
 * Count the prompt tokens of a request with the model's own tokenizer. `/v1/tokenize` takes one raw string, not a chat, so the text the model reads
 * (messages, reasoning, tool plans, tool calls, tool definitions and documents) is sent in pieces of at most 65,536 characters and the counts are
 * added. The result is the tokenizer's count of that text: the few tokens of chat template around each message are not in it, so it is a little
 * below what the chat endpoint bills, and much closer than the estimate of one token per four characters.
 * @param {any} context - `{ endpoint, request, transport, signal, timeout }`.
 * @returns {Promise<number | null>} Token count, or null when Cohere did not answer, or the prompt needs more than 16 calls (the caller falls back to an estimate).
 */
export function count({ endpoint, request, transport, signal, timeout }: any): Promise<number | null>;
