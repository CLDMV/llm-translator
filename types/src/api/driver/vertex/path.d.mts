/**
 * Build the `rawPredict` path (`streamRawPredict` when `stream` is true) from the upstream's project and region and the request's model.
 * @param {"messages" | "count"} kind - Which call.
 * @param {any} context - `{ endpoint, model, stream }`.
 * @returns {string} Path starting with `/v1/projects/`.
 */
export function path(kind: "messages" | "count", { endpoint, model, stream }: any): string;
