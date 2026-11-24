/**
 * Check the `bedrock` setting: `cache` (false stops `cache_control` from becoming Converse cache points) is the only key.
 * @param {any} value - The setting.
 * @returns {string | null} What is wrong with it, or null when it is fine.
 */
export function check(value: any): string | null;
