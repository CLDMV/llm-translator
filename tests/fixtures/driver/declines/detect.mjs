/**
 * @fileoverview Test driver that names a host in `info().hosts` but whose `detect` declines it.
 * @module @cldmv/llm-translator/test/driver/declines
 */

/**
 * Decline every endpoint.
 * @returns {null} Always null.
 */
export function detect() {
	return null;
}
