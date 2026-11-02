/**
 * Describe the vLLM driver.
 * @returns {{name: string, protocol: string, order: number, auth: string, fields: string[], paths: Record<string,string>}} Driver facts.
 */
export function info(): {
    name: string;
    protocol: string;
    order: number;
    auth: string;
    fields: string[];
    paths: Record<string, string>;
};
