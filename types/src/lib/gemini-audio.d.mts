/**
 * Load the encoder of a format. Safe to call repeatedly; a loaded encoder is kept.
 * @param {string} format - `mp3`, `opus` or `flac`.
 * @param {(name: string) => Promise<any>} [importer] - Module importer (overridable for tests).
 * @returns {Promise<void>} Resolves when `encode` can be used for the format.
 * @throws {TranslatorError} `audio_encoder_unavailable` when the package cannot be loaded.
 */
export function load(format: string, importer?: (name: string) => Promise<any>): Promise<void>;
/**
 * Forget the loaded encoders (for tests).
 * @returns {void}
 */
export function reset(): void;
/**
 * One Ogg page (exported for tests).
 * @param {{flags: number, granule: number, serial: number, sequence: number, packets: Buffer[]}} spec - The flags (1 continued, 2 first page, 4 last page), the granule position, the stream serial number, the page number and the packets, each ending in this page.
 * @returns {Buffer} The page.
 */
export function page({ flags, granule, serial, sequence, packets }: {
    flags: number;
    granule: number;
    serial: number;
    sequence: number;
    packets: Buffer[];
}): Buffer;
/**
 * Encode 16-bit little-endian mono PCM.
 * @param {Buffer} pcm - Raw samples.
 * @param {number} rate - Sample rate.
 * @param {string} format - `mp3`, `opus` or `flac`.
 * @returns {Buffer} The encoded file.
 * @throws {TranslatorError} `audio_encoder_unavailable` when the format's encoder was not loaded.
 */
export function encode(pcm: Buffer, rate: number, format: string): Buffer;
/** The formats this module encodes. */
export const FORMATS: readonly string[];
