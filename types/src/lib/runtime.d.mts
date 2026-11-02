/**
 * Per-instance context (`config`, `state`); valid only synchronously inside a leaf call.
 * @type {any}
 */
export const context: any;
/**
 * Proxy over the whole api (`self.convert.…`, `self.driver.…`); valid only synchronously inside a leaf call.
 * @type {any}
 */
export const self: any;
