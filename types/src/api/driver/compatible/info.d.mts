/**
 * Describe the generic OpenAI-compatible driver (matches last, after every specific driver).
 * @returns {{name: string, protocol: string, order: number, auth: string, strict: boolean, fields: string[], paths: Record<string,string>}} Driver facts.
 */
export function info(): {
    name: string;
    protocol: string;
    order: number;
    auth: string;
    strict: boolean;
    fields: string[];
    paths: Record<string, string>;
};
