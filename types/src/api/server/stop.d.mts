/**
 * Close all servers started with `server.start`.
 * @returns {Promise<void>} Resolves when every server has closed.
 */
export function stop(): Promise<void>;
