/**
 * Describe the Fireworks AI driver (see `PRESETS.fireworks` in `lib/presets.mjs`).
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
