/**
 * Stop the running batches, then close all servers started with `server.start`.
 * @returns {Promise<void>} Resolves when every server has closed.
 */
export function stop(): Promise<void>;
