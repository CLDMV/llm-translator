/**
 * Split typed content chunks into answer text and thinking. `{type:"text"}` chunks make the text, `{type:"thinking"}` chunks make the thinking
 * (their `thinking` field is a list of text chunks, or a string); other chunk types are skipped.
 * @param {any} content - Message or delta `content`.
 * @returns {{ text: string, thinking: string } | null} The parts, or null when `content` is not an array.
 */
export function flatten(content: any): {
    text: string;
    thinking: string;
} | null;
