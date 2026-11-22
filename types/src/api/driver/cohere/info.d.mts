/**
 * Describe the Cohere driver. `protocol` is the OpenAI Compatibility API (`/compatibility/v1/chat/completions`); `cohere.chat`, Cohere's own
 * `/v2/chat`, is used when an upstream selects it with `api: "cohere"` (nothing under `auto` speaks it). The real paths come from the `path` leaf,
 * because the native API sits outside the Compatibility API's path root.
 * @returns {{name: string, protocol: string, protocols: string[], order: number, auth: string, strict: boolean, n: boolean, hosts: string[], paths: Record<string,string>}} Driver facts.
 */
export function info(): {
    name: string;
    protocol: string;
    protocols: string[];
    order: number;
    auth: string;
    strict: boolean;
    n: boolean;
    hosts: string[];
    paths: Record<string, string>;
};
