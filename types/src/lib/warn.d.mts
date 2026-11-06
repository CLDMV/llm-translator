/**
 * Emit a warning event (type `warning` unless `details.type` names a specific one). The console prints it once per message when
 * `logs` is on; listeners and the log file see every occurrence.
 * @param {any} config - Normalized config.
 * @param {any} state - Translator state.
 * @param {string} message - Warning text.
 * @param {{type?: string, kind?: string, log?: any, [detail: string]: any}} [details] - Event type, kind and further payload fields.
 * @returns {void}
 */
export function warn(config: any, state: any, message: string, details?: {
    type?: string;
    kind?: string;
    log?: any;
    [detail: string]: any;
}): void;
