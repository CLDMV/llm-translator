/**
 * Build the `rawPredict` path (`streamRawPredict` when `stream` is true) from the upstream's project and region and the request's model. A
 * request on the `google.gemini` protocol goes to the Google publisher's `generateContent` (`streamGenerateContent?alt=sse`) instead.
 * @param {"messages" | "count" | "gemini"} kind - Which call.
 * @param {any} context - `{ endpoint, model, protocol, stream }`.
 * @returns {string} Path starting with `/v1/projects/`.
 */
export function path(kind: "messages" | "count" | "gemini", { endpoint, model, protocol, stream }: any): string;
