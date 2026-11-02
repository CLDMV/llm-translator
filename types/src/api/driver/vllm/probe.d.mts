/**
 * Probe a vLLM server for facts that need a request.
 *
 * - `inlineSystem`: `POST /tokenize` with `[system, user, system, user]`. Success means the chat template tolerates system
 *   messages in the middle of a conversation (`keep`), failure means they must be folded into user turns (`user`).
 * - `images`: a one-token chat completion with a 1x1 image. `false` when the server answers 400 that the model is not
 *   multimodal (so images and PDF page images are replaced by notes instead of failing every request), `true` when it
 *   accepts the request, and absent when the answer is inconclusive (timeouts, other errors).
 * @param {{ endpoint: any, transport: Function, signal?: AbortSignal, timeout?: number, facts?: any, want?: { inlineSystem?: boolean, images?: boolean } }} context - Probe context. `want` selects the checks (`inlineSystem` defaults to on, `images` to off).
 * @returns {Promise<{ inlineSystem?: "keep"|"user", images?: boolean }>} Probed settings.
 */
export function probe({ endpoint, transport, signal, timeout, facts, want }: {
    endpoint: any;
    transport: Function;
    signal?: AbortSignal;
    timeout?: number;
    facts?: any;
    want?: {
        inlineSystem?: boolean;
        images?: boolean;
    };
}): Promise<{
    inlineSystem?: "keep" | "user";
    images?: boolean;
}>;
