/**
 * Settings for a vLLM server. An unknown version is treated as the latest release, except `thinkingBudget`, which needs a known version of 0.19.0 or later.
 * @param {{version?: string}} [facts] - Detection facts (or the configured version).
 * @returns {any} Partial settings.
 */
export function settings(facts?: {
    version?: string;
}): any;
