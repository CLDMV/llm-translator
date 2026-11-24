/**
 * Stop every batch that is running (their requests are aborted and the batches end as cancelled) and wait until they have. `server.stop` calls it; a program
 * that uses the batch api without a server calls it before it shuts down. Does nothing when no batch was ever made or `batches` is null.
 * @returns {Promise<void>} Resolves when no batch is running.
 */
export function stop(): Promise<void>;
