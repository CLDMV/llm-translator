/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/lib/cli.mjs
 *	@Date: 2026-10-25T12:29:36-07:00 (1792956576)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-10-25T12:59:01-07:00 (1792958341)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */
/**
 * Parse the command line.
 * @param {string[]} argv - Arguments without the node and script paths.
 * @returns {any} Parsed values (see `parseArgs`).
 */
export declare function parse(argv: string[]): any;
/**
 * Merge flags, environment and the config file into `{ translator, server }`.
 * @param {any} values - Parsed flags.
 * @param {Record<string,string | undefined>} env - Environment.
 * @param {any} file - Parsed config file ({} when none).
 * @returns {{translator: any, server: any}} Translator config and server options.
 */
export declare function merge(values: any, env: Record<string, string | undefined>, file: any): {
    translator: any;
    server: any;
};
/**
 * Default I/O bindings for `main`.
 * @type {{out: (text: string) => void, err: (text: string) => void, onSignal: (handler: () => void) => void}}
 */
export declare const processIo: {
    out: (text: string) => void;
    err: (text: string) => void;
    onSignal: (handler: () => void) => void;
};
/**
 * Run the CLI. Resolves with the exit code once the server stopped (after a signal) or startup failed.
 * @param {string[]} argv - Arguments without the node and script paths.
 * @param {Record<string,string | undefined>} [env] - Environment.
 * @param {typeof processIo} [io] - Output and signal bindings.
 * @param {any} [lib] - Overridable collaborators `{ createTranslator, version }` (loaded lazily when omitted).
 * @returns {Promise<number>} Process exit code.
 */
export declare function main(argv: string[], env?: Record<string, string | undefined>, io?: typeof processIo, lib?: any): Promise<number>;
