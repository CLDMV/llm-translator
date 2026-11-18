/**
 * Escape a label value: backslash, double quote and line feed.
 * @param {any} value - Label value.
 * @returns {string} Escaped text.
 */
export function escapeLabel(value: any): string;
/**
 * Escape `# HELP` text: backslash and line feed.
 * @param {string} text - Help text.
 * @returns {string} Escaped text.
 */
export function escapeHelp(text: string): string;
/**
 * Create an empty registry.
 * @returns {{ counter: (name: string, help: string) => void, histogram: (name: string, help: string, buckets?: number[]) => void, inc: (name: string, labels: Record<string, any>, by?: number) => void, observe: (name: string, labels: Record<string, any>, value: number) => void, render: (gauges?: {name: string, help: string, samples: {labels: Record<string, any>, value: number}[]}[]) => string }} Registry.
 */
export function create(): {
    counter: (name: string, help: string) => void;
    histogram: (name: string, help: string, buckets?: number[]) => void;
    inc: (name: string, labels: Record<string, any>, by?: number) => void;
    observe: (name: string, labels: Record<string, any>, value: number) => void;
    render: (gauges?: {
        name: string;
        help: string;
        samples: {
            labels: Record<string, any>;
            value: number;
        }[];
    }[]) => string;
};
/**
 * The kind of an error, or null when the request did not fail: `upstream` (the upstream answered with an error or could not be reached
 * as far as the usage report knows), `translator` (a failure in the translator itself, a 5xx or an in-band stream error) and `client`
 * (a refused request: bad body, authentication, unknown model or route). A client that left is not an error.
 * @param {number} status - HTTP status as written (499 when the client left).
 * @param {any} report - The request's usage report, or null.
 * @returns {"upstream" | "translator" | "client" | null} Kind.
 */
export function kind(status: number, report: any): "upstream" | "translator" | "client" | null;
/**
 * Create the metrics of one server: a registry plus the request recorder and the scrape renderer. Label values stay bounded: `front` is
 * one of two protocols, `route` is the route pattern (never the URL), `driver` is a driver name, `upstream` a configured upstream name
 * and `code` an HTTP status. The model a client asked for, request ids and API keys are never labels.
 * @param {{ front: "anthropic" | "openai", endpoints: () => any[] }} source - The server's front and its runtime endpoints.
 * @returns {{ hook: (request: any, reply: any) => Promise<void>, attach: (request: any, sending: Promise<any>) => void, render: () => string }} Recorder.
 */
export function recorder(source: {
    front: "anthropic" | "openai";
    endpoints: () => any[];
}): {
    hook: (request: any, reply: any) => Promise<void>;
    attach: (request: any, sending: Promise<any>) => void;
    render: () => string;
};
/** `Content-Type` of the text exposition format. */
export const CONTENT_TYPE: "text/plain; version=0.0.4; charset=utf-8";
/** Request duration buckets in seconds: LLM replies run from milliseconds (errors, embeddings) to minutes (long streams). */
export const BUCKETS: number[];
