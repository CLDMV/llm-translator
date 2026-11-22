/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/lib/gemini-audio.mjs
 *	@Date: 2026-11-22T10:00:00-08:00 (1795370400)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-11-22T10:00:00-08:00 (1795370400)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

/**
 * @fileoverview Audio encoders for Gemini's audio output: Gemini returns raw 16-bit PCM, and this turns it into MP3 (`wasm-media-encoders`), Opus in an Ogg container (`opusscript` and a small Ogg writer) or FLAC (`libflacjs`). The encoder packages are optional and loaded lazily, like `@napi-rs/canvas` in `lib/pdf.mjs`: `load` is awaited when a request asks for a format, so an encoder that is missing is a clear error before anything is sent, and `encode` itself is synchronous.
 * @module @cldmv/llm-translator/lib/gemini-audio
 */
import { TranslatorError } from "./errors.mjs";

/** The package each encoded format needs. */
const PACKAGES = { mp3: "wasm-media-encoders", opus: "opusscript", flac: "libflacjs" };

/** The formats this module encodes. */
export const FORMATS = Object.freeze(Object.keys(PACKAGES));

/** Sample rates Opus takes. */
const OPUS_RATES = new Set([8000, 12000, 16000, 24000, 48000]);

/** Loaded encoders by format. */
const loaded = { mp3: null, opus: null, flac: null };

/**
 * The error for a format whose encoder package cannot be used.
 * @param {string} format - Format.
 * @param {string} reason - Why.
 * @returns {TranslatorError} Error with code `audio_encoder_unavailable` (501).
 */
function unavailable(format, reason) {
	return new TranslatorError(
		`audio.format "${format}" needs the optional package ${PACKAGES[format]}, which is not usable here (${reason}); install it, or ask for wav or pcm16`,
		{ code: "audio_encoder_unavailable", status: 501, param: "audio.format" }
	);
}

/**
 * Load the encoder of a format. Safe to call repeatedly; a loaded encoder is kept.
 * @param {string} format - `mp3`, `opus` or `flac`.
 * @param {(name: string) => Promise<any>} [importer] - Module importer (overridable for tests).
 * @returns {Promise<void>} Resolves when `encode` can be used for the format.
 * @throws {TranslatorError} `audio_encoder_unavailable` when the package cannot be loaded.
 */
export async function load(format, importer = (name) => import(name)) {
	if (loaded[format] !== null) return;
	try {
		if (format === "mp3") {
			const module = await importer("wasm-media-encoders");
			loaded.mp3 = await module.createMp3Encoder();
		} else if (format === "opus") {
			const module = await importer("opusscript");
			loaded.opus = module.default;
		} else {
			const module = await importer("libflacjs");
			const Flac = module.default("release");
			if (!Flac.isReady()) await new Promise((resolve) => Flac.on("ready", resolve));
			const encoder = await importer("libflacjs/lib/encoder.js");
			loaded.flac = { Flac, Encoder: encoder.Encoder };
		}
	} catch (cause) {
		throw unavailable(format, String(cause?.message ?? cause));
	}
}

/**
 * Forget the loaded encoders (for tests).
 * @returns {void}
 */
export function reset() {
	for (const key of Object.keys(loaded)) loaded[key] = null;
}

/**
 * MP3 of 16-bit mono PCM.
 * @param {Int16Array} samples - Samples.
 * @param {number} rate - Sample rate.
 * @returns {Buffer} MP3 file.
 */
function mp3(samples, rate) {
	const encoder = loaded.mp3;
	encoder.configure({ sampleRate: rate, channels: 1, vbrQuality: 2 });
	const head = Buffer.from(encoder.encode([Float32Array.from(samples, (value) => value / 32768)]));
	return Buffer.concat([head, Buffer.from(encoder.finalize())]);
}

/**
 * FLAC of 16-bit mono PCM.
 * @param {Int16Array} samples - Samples.
 * @param {number} rate - Sample rate.
 * @returns {Buffer} FLAC file.
 */
function flac(samples, rate) {
	const { Flac, Encoder } = loaded.flac;
	const encoder = new Encoder(Flac, {
		sampleRate: rate,
		channels: 1,
		bitsPerSample: 16,
		compression: 5,
		verify: false,
		totalSamples: samples.length
	});
	try {
		encoder.encode(Int32Array.from(samples));
		encoder.encode();
		return Buffer.from(encoder.getSamples());
	} finally {
		encoder.destroy();
	}
}

/** The lookup table of the CRC-32 an Ogg page carries (polynomial 0x04C11DB7, not reflected, start 0). */
const CRC = Uint32Array.from({ length: 256 }, (_, index) => {
	let value = index << 24;
	for (let bit = 0; bit < 8; bit++) value = value & 0x80000000 ? (value << 1) ^ 0x04c11db7 : value << 1;
	return value >>> 0;
});

/**
 * One Ogg page (exported for tests).
 * @param {{flags: number, granule: number, serial: number, sequence: number, packets: Buffer[]}} spec - The flags (1 continued, 2 first page, 4 last page), the granule position, the stream serial number, the page number and the packets, each ending in this page.
 * @returns {Buffer} The page.
 */
export function page({ flags, granule, serial, sequence, packets }) {
	const lacing = [];
	for (const packet of packets) {
		for (let left = packet.length; left >= 255; left -= 255) lacing.push(255);
		lacing.push(packet.length % 255);
	}
	const head = Buffer.alloc(27 + lacing.length);
	head.write("OggS", 0);
	head.writeUInt8(flags, 5);
	head.writeBigUInt64LE(BigInt(granule), 6);
	head.writeUInt32LE(serial, 14);
	head.writeUInt32LE(sequence, 18);
	head.writeUInt8(lacing.length, 26);
	lacing.forEach((value, at) => head.writeUInt8(value, 27 + at));
	const out = Buffer.concat([head, ...packets]);
	let crc = 0;
	for (const byte of out) crc = ((crc << 8) ^ CRC[((crc >>> 24) ^ byte) & 255]) >>> 0;
	out.writeUInt32LE(crc, 22);
	return out;
}

/**
 * Opus of 16-bit mono PCM, in an Ogg container (the `opus` format of OpenAI: 20 ms frames, one packet each).
 * @param {Int16Array} samples - Samples.
 * @param {number} rate - Sample rate (8, 12, 16, 24 or 48 kHz).
 * @returns {Buffer} Ogg Opus file.
 */
function opus(samples, rate) {
	if (!OPUS_RATES.has(rate)) throw unavailable("opus", `Opus takes 8, 12, 16, 24 and 48 kHz audio, not ${rate} Hz`);
	const Encoder = loaded.opus;
	const encoder = new Encoder(rate, 1, Encoder.Application.AUDIO);
	const size = rate / 50;
	const step = 48000 / rate;
	const packets = [];
	try {
		for (let at = 0; at < samples.length; at += size) {
			const frame = Buffer.alloc(size * 2);
			Buffer.from(samples.buffer, samples.byteOffset + at * 2, Math.min(size, samples.length - at) * 2).copy(frame);
			packets.push(Buffer.from(encoder.encode(frame, size)));
		}
	} finally {
		encoder.delete();
	}
	const skip = 312;
	const serial = 0x6c6c6d74;
	const header = Buffer.alloc(19);
	header.write("OpusHead", 0);
	header.writeUInt8(1, 8);
	header.writeUInt8(1, 9);
	header.writeUInt16LE(skip, 10);
	header.writeUInt32LE(rate, 12);
	const vendor = Buffer.from("llm-translator");
	const tags = Buffer.concat([Buffer.from("OpusTags"), Buffer.from(Uint32Array.of(vendor.length).buffer), vendor, Buffer.alloc(4)]);
	const pages = [
		page({ flags: 2, granule: 0, serial, sequence: 0, packets: [header] }),
		page({ flags: 0, granule: 0, serial, sequence: 1, packets: [tags] })
	];
	let sequence = 2;
	for (let at = 0; at < packets.length || at === 0; at += 40) {
		const group = packets.slice(at, at + 40);
		const last = at + 40 >= packets.length;
		const granule = last ? skip + samples.length * step : skip + (at + group.length) * size * step;
		pages.push(page({ flags: last ? 4 : 0, granule, serial, sequence: sequence++, packets: group }));
		if (last) break;
	}
	return Buffer.concat(pages);
}

/**
 * Encode 16-bit little-endian mono PCM.
 * @param {Buffer} pcm - Raw samples.
 * @param {number} rate - Sample rate.
 * @param {string} format - `mp3`, `opus` or `flac`.
 * @returns {Buffer} The encoded file.
 * @throws {TranslatorError} `audio_encoder_unavailable` when the format's encoder was not loaded.
 */
export function encode(pcm, rate, format) {
	if (!FORMATS.includes(format) || loaded[format] === null) throw unavailable(format, "it was not loaded");
	const even = pcm.subarray(0, pcm.length - (pcm.length % 2));
	const samples = new Int16Array(even.buffer.slice(even.byteOffset, even.byteOffset + even.length));
	return format === "mp3" ? mp3(samples, rate) : format === "flac" ? flac(samples, rate) : opus(samples, rate);
}
