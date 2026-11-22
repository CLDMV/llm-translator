/**
 * The last `cache_control` breakpoint of an Anthropic request, in the order Anthropic reads it: tools, system, messages.
 * @param {any} body - Anthropic Messages body.
 * @returns {{where: "tools" | "system" | "messages", message?: number, block?: number, ttl: number} | null} Where it is and how long the cache lives, or null when there is none.
 */
export function breakpoint(body: any): {
    where: "tools" | "system" | "messages";
    message?: number;
    block?: number;
    ttl: number;
} | null;
/**
 * The request as far as a breakpoint: every tool and every system block (a breakpoint in either counts as one after both), and the messages up to the block.
 * @param {any} body - Anthropic Messages body.
 * @param {{where: string, message?: number, block?: number}} point - The breakpoint.
 * @returns {any} The shortened body.
 */
export function upTo(body: any, point: {
    where: string;
    message?: number;
    block?: number;
}): any;
/**
 * What to cache, from the Gemini body of the shortened request and the one of the whole request: the leading messages the two share, whole, and
 * the system instruction, tools and tool config, which have to be the same in both because a request that uses a cache carries none of them.
 * @param {any} prefix - `generateContent` body of the shortened request.
 * @param {any} full - `generateContent` body of the whole request.
 * @param {number} ttl - Seconds the cache lives.
 * @returns {{contents: any[], count: number, systemInstruction?: any, tools?: any, toolConfig?: any, ttl: number} | null} The plan, or null when there is nothing worth caching or the two do not agree.
 */
export function planOf(prefix: any, full: any, ttl: number): {
    contents: any[];
    count: number;
    systemInstruction?: any;
    tools?: any;
    toolConfig?: any;
    ttl: number;
} | null;
/**
 * Make the request use a cached content: find the one for this prefix or create it, then drop what the cache holds from the body. When the
 * cache cannot be made (too short for the model, refused, unreachable) the body is returned as it was and the prefix is not tried again for a while.
 * @param {{cache: any, body: any, endpoint: any, headers: Record<string, string>, transport: Function, timeout: number, model: string, url: string, resource: string, warn?: (message: string) => void}} spec - `cache` is the plan, `url` is the `cachedContents` collection to create in and `resource` the model's resource name for it, `model` is the model id (for the key).
 * @returns {Promise<any>} The body to send.
 */
export function apply({ cache, body, endpoint, headers, transport, timeout, model, url, resource, warn }: {
    cache: any;
    body: any;
    endpoint: any;
    headers: Record<string, string>;
    transport: Function;
    timeout: number;
    model: string;
    url: string;
    resource: string;
    warn?: (message: string) => void;
}): Promise<any>;
