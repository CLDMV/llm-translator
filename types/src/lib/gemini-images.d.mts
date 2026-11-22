/**
 * Replace every GIF image part of a Chat Completions body by a PNG one. A base64 GIF is decoded; a GIF at an http(s) URL is fetched when the
 * `documentUrls` setting is on (with its allow list and limits, and nothing else is fetched) and decoded. A GIF that cannot be had stays as it is,
 * and the body builder leaves a note in its place. The body is not changed: a copy is returned when anything was replaced.
 * @param {any} body - Chat Completions body.
 * @param {{options: any, report?: (event: {kind: string, message: string, [detail: string]: any}) => void, signal?: AbortSignal, fetch?: Function, deps?: any}} spec - The normalized `documentUrls` setting (null when fetching is off), a function that receives one event per fetch, the caller's abort signal, and replaceable parts for tests.
 * @returns {Promise<any>} The body.
 */
export function prepare(body: any, { options, report, signal, fetch, deps }: {
    options: any;
    report?: (event: {
        kind: string;
        message: string;
        [detail: string]: any;
    }) => void;
    signal?: AbortSignal;
    fetch?: Function;
    deps?: any;
}): Promise<any>;
