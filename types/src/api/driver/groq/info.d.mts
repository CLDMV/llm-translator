/**
 * Describe the Groq driver (see `PRESETS.groq` in `lib/presets.mjs`).
 * @returns {{name: string, protocol: string, order: number, auth: string, strict: boolean, fields?: string[], paths: Record<string,string>}} Driver facts.
 */
export function info(): {
    name: string;
    protocol: string;
    order: number;
    auth: string;
    strict: boolean;
    fields?: string[];
    paths: Record<string, string>;
};
