/**
 * Parse the command line.
 * @param {string[]} argv - Arguments without the node and script paths.
 * @returns {any} Parsed values (see `parseArgs`).
 */
export function parse(argv: string[]): any;
/**
 * Merge flags, environment and the config file into `{ translator, server }`.
 * @param {any} values - Parsed flags.
 * @param {Record<string,string | undefined>} env - Environment.
 * @param {any} file - Parsed config file ({} when none).
 * @returns {{translator: any, server: any}} Translator config and server options.
 */
export function merge(values: any, env: Record<string, string | undefined>, file: any): {
    translator: any;
    server: any;
};
/**
 * Run the CLI. Resolves with the exit code once the server stopped (after a signal) or startup failed.
 * @param {string[]} argv - Arguments without the node and script paths.
 * @param {Record<string,string | undefined>} [env] - Environment.
 * @param {typeof processIo} [io] - Output and signal bindings.
 * @param {any} [lib] - Overridable collaborators `{ createTranslator, version }` (loaded lazily when omitted).
 * @returns {Promise<number>} Process exit code.
 */
export function main(argv: string[], env?: Record<string, string | undefined>, io?: typeof processIo, lib?: any): Promise<number>;
/**
 * Default I/O bindings for `main`.
 * @type {{out: (text: string) => void, err: (text: string) => void, onSignal: (handler: () => void) => void}}
 */
export const processIo: {
    out: (text: string) => void;
    err: (text: string) => void;
    onSignal: (handler: () => void) => void;
};
