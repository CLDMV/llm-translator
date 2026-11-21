/**
 * Describe the Gemini driver (see `PRESETS.gemini` in `lib/presets.mjs`). `protocol` is the OpenAI-compatible endpoint, the default; the native
 * `generateContent` API (`google.gemini`) is used only by an upstream with an explicit `api`, because no client speaks it.
 * @returns {{name: string, protocol: string, protocols: string[], order: number, auth: string, strict: boolean, fields?: string[], paths: Record<string,string>}} Driver facts.
 */
export function info(): {
    name: string;
    protocol: string;
    protocols: string[];
    order: number;
    auth: string;
    strict: boolean;
    fields?: string[];
    paths: Record<string, string>;
};
