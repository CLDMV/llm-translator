/**
 * The neutral citations of a candidate's grounding and citation metadata, as Chat Completions annotations.
 * @param {{groundingMetadata?: any, citationMetadata?: any}} metadata - The candidate's metadata (the latest of each seen so far, for a stream).
 * @param {{text: string, at: number}[]} parts - The text parts of the reply (adjacent text parts merged), with where each starts in the content.
 * @returns {any[]} Annotations (`toAnnotation`), in the order of the text.
 */
export function annotationsOf(metadata: {
    groundingMetadata?: any;
    citationMetadata?: any;
}, parts: {
    text: string;
    at: number;
}[]): any[];
