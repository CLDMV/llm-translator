/**
 * @typedef {object} TranslatorEvent
 * @property {string} type Specific event name (`fallback`, `failover`, `effort`, `dropped`, `detect`, `usage`, `warning`, `error` or `log`).
 * @property {string} [kind] Sub-kind within the type (for example `json_object` for a `fallback`).
 * @property {"debug" | "info" | "warn" | "error"} level Severity.
 * @property {string} message Human readable text.
 * @property {number} time Milliseconds since the epoch.
 */
/**
 * The state the emitter keeps in `state`: listeners by event name, the log sink, and the server's logger once one is registered.
 * @param {((event: TranslatorEvent) => any) | undefined} [onEvent] - Config callback, registered for every event.
 * @returns {{listeners: Map<string, Set<Function>>, sink: {console: boolean, file: string | null}, logger: any}} Emitter state.
 */
export function create(onEvent?: ((event: TranslatorEvent) => any) | undefined): {
    listeners: Map<string, Set<Function>>;
    sink: {
        console: boolean;
        file: string | null;
    };
    logger: any;
};
/**
 * Configure where logging goes: nothing, the console, or a JSON lines file. A file that cannot be opened is reported once on
 * the console and logging stays off; this never throws.
 * @param {any} emitter - Emitter state from {@link create}.
 * @param {boolean | string} logs - Normalized `logs` option.
 * @returns {void}
 */
export function open(emitter: any, logs: boolean | string): void;
/**
 * Subscribe to an event.
 * @param {any} emitter - Emitter state.
 * @param {string} name - Event name, or `"*"` for every event.
 * @param {(event: TranslatorEvent) => any} fn - Listener.
 * @returns {() => void} Unsubscribe function.
 */
export function on(emitter: any, name: string, fn: (event: TranslatorEvent) => any): () => void;
/**
 * Remove a listener (a listener that is not subscribed is ignored).
 * @param {any} emitter - Emitter state.
 * @param {string} name - Event name.
 * @param {Function} fn - Listener passed to {@link on}.
 * @returns {void}
 */
export function off(emitter: any, name: string, fn: Function): void;
/**
 * Emit one occurrence. The specific event fires first, then the general ones that fit (`warning` for level `warn`, `error` for level
 * `error`, always `log`), then `"*"`; all with the same payload. Listeners only observe. Logging is fed from here too, and does not
 * depend on `events`.
 * @param {{config: any, state: any}} ctx - Translator `{ config, state }`.
 * @param {{type: string, kind?: string, level?: "debug" | "info" | "warn" | "error", message: string, log?: any, [detail: string]: any}} spec - What happened: `type`, optional `kind`, `level` (default `info`), `message`, further details, and `log` (see {@link write}; not part of the payload).
 * @returns {TranslatorEvent} The payload.
 */
export function emit({ config, state }: {
    config: any;
    state: any;
}, spec: {
    type: string;
    kind?: string;
    level?: "debug" | "info" | "warn" | "error";
    message: string;
    log?: any;
    [detail: string]: any;
}): TranslatorEvent;
export type TranslatorEvent = {
    /**
     * Specific event name (`fallback`, `failover`, `effort`, `dropped`, `detect`, `usage`, `warning`, `error` or `log`).
     */
    type: string;
    /**
     * Sub-kind within the type (for example `json_object` for a `fallback`).
     */
    kind?: string;
    /**
     * Severity.
     */
    level: "debug" | "info" | "warn" | "error";
    /**
     * Human readable text.
     */
    message: string;
    /**
     * Milliseconds since the epoch.
     */
    time: number;
};
