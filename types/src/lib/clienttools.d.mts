/**
 * The function tools that stand for one of Anthropic's client tools.
 * @param {any} tool - A tool of the request that has a `type`.
 * @returns {{ name: string, description: string, parameters: any, toolset?: string }[] | null} The functions (one, or the members of the toolset), or null when the type is not a client tool the translator knows (a server tool, or a version it has no schema for).
 */
export function emulate(tool: any): {
    name: string;
    description: string;
    parameters: any;
    toolset?: string;
}[] | null;
/**
 * The system prompt text Anthropic adds for the tools of a request, for the ones that stand in as function tools and whose text Anthropic publishes: the memory tool's protocol and the opening of the computer use prompt.
 * Each text appears once however many tools ask for it. No text is published for the bash and text editor tools, so none is added.
 * @param {any[]} tools - The request's `tools`.
 * @returns {string[]} Texts, in the order of the tools.
 */
export function prompts(tools: any[]): string[];
/** The protocol text Anthropic adds to the system prompt when the memory tool is present, as its memory tool page prints it. */
export const MEMORY_PROMPT: "IMPORTANT: ALWAYS VIEW YOUR MEMORY DIRECTORY BEFORE DOING ANYTHING ELSE.\nMEMORY PROTOCOL:\n1. Use the `view` command of your `memory` tool to check for earlier progress.\n2. ... (work on the task) ...\n   - As you make progress, record status / progress / thoughts etc in your memory.\nASSUME INTERRUPTION: Your context window might be reset at any moment, so you risk losing any progress that is not recorded in your memory directory.";
/** The start of the system prompt Anthropic generates when the computer tool is present, as its computer use page prints it (the page does not print the rest). */
export const COMPUTER_PROMPT: "You have access to a set of functions you can use to answer the user\u2019s question. This includes access to a sandboxed computing environment. You do NOT currently have the ability to inspect files or interact with external resources, except by invoking the below functions.";
/** The toolset the members belong to; a call of a member is returned with this as `toolset_name`. */
export const TOOLSET: "computer";
