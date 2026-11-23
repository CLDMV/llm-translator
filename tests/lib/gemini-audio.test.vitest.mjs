/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /tests/lib/gemini-audio.test.vitest.mjs
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
 * @fileoverview Audio encoders for Gemini's PCM output: MP3, Ogg Opus (pages, lacing and CRC checked) and FLAC, loading, reuse, and the clear errors for a missing package, an unsupported rate and an encoder that was never loaded.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { FORMATS, encode, load, page, reset } from "../../src/lib/gemini-audio.mjs";

/** Two seconds of a 24 kHz sine wave, 16-bit little-endian mono. */
const rate = 24000;
const pcm = Buffer.alloc(rate * 2 * 2);
for (let at = 0; at < rate * 2; at++) pcm.writeInt16LE(Math.round(8000 * Math.sin(at / 8)), at * 2);

/**
 * Read the pages of an Ogg file, checking each CRC.
 * @param {Buffer} file - Ogg file.
 * @returns {{flags: number, granule: bigint, sequence: number, packets: Buffer[], crc: boolean}[]} Pages.
 */
function pages(file) {
	const out = [];
	for (let at = 0; at < file.length;) {
		expect(file.subarray(at, at + 4).toString()).toBe("OggS");
		const count = file[at + 26];
		const lacing = [...file.subarray(at + 27, at + 27 + count)];
		const body = lacing.reduce((sum, value) => sum + value, 0);
		const size = 27 + count + body;
		const raw = Buffer.from(file.subarray(at, at + size));
		const stored = raw.readUInt32LE(22);
		raw.writeUInt32LE(0, 22);
		let crc = 0;
		for (const byte of raw) {
			crc ^= byte << 24;
			for (let bit = 0; bit < 8; bit++) crc = crc & 0x80000000 ? (crc << 1) ^ 0x04c11db7 : crc << 1;
			crc >>>= 0;
		}
		const packets = [];
		let start = at + 27 + count;
		let length = 0;
		for (const value of lacing) {
			length += value;
			if (value < 255) {
				packets.push(file.subarray(start, start + length));
				start += length;
				length = 0;
			}
		}
		out.push({
			flags: file[at + 5],
			granule: file.readBigUInt64LE(at + 6),
			sequence: file.readUInt32LE(at + 18),
			packets,
			crc: crc === stored
		});
		at += size;
	}
	return out;
}

beforeEach(() => reset());

describe("gemini audio", () => {
	it("names the formats it encodes", () => {
		expect(FORMATS).toEqual(["mp3", "opus", "flac"]);
	});

	it("encodes MP3 that starts with a frame header, and can be used again", async () => {
		await load("mp3");
		await load("mp3");
		const first = encode(pcm, rate, "mp3");
		expect(first[0]).toBe(0xff);
		expect(first[1] & 0xe0).toBe(0xe0);
		expect(first.length).toBeGreaterThan(1000);
		expect(encode(pcm, rate, "mp3").equals(first)).toBe(true);
	});

	it("encodes FLAC with the stream header and the real sample count, and after a reload too", async () => {
		await load("flac");
		const file = encode(pcm, rate, "flac");
		expect(file.subarray(0, 4).toString()).toBe("fLaC");
		// STREAMINFO: 20 bits of sample rate, 3 of channels - 1, 5 of bits - 1, 36 of samples, from byte 18.
		expect(file.readUIntBE(18, 3) >> 4).toBe(rate);
		expect(Number(file.readBigUInt64BE(18) & 0xfffffffffn)).toBe(rate * 2);
		reset();
		await load("flac");
		expect(encode(pcm, rate, "flac").equals(file)).toBe(true);
	});

	it("encodes Opus in Ogg: head, tags, then 20 ms packets on pages with a good CRC, ending with the last-page flag", async () => {
		await load("opus");
		const file = encode(pcm, rate, "opus");
		const list = pages(file);
		expect(list.every((entry) => entry.crc)).toBe(true);
		expect(list.map((entry) => entry.sequence)).toEqual(list.map((_, at) => at));
		expect(list[0]).toMatchObject({ flags: 2, granule: 0n });
		expect(list[0].packets[0].subarray(0, 8).toString()).toBe("OpusHead");
		expect(list[0].packets[0].readUInt32LE(12)).toBe(rate);
		expect(list[1].packets[0].subarray(0, 8).toString()).toBe("OpusTags");
		expect(list.at(-1).flags).toBe(4);
		const frames = list.slice(2).reduce((sum, entry) => sum + entry.packets.length, 0);
		expect(frames).toBe(100);
		expect(list.slice(2).every((entry) => entry.packets.length <= 40)).toBe(true);
		expect(list.at(-1).granule).toBe(312n + BigInt(rate * 2 * 2));
		expect(list[2].granule).toBe(312n + 40n * 960n);
	});

	it("pads the last frame, and writes one page for no samples", async () => {
		await load("opus");
		const short = pages(encode(pcm.subarray(0, 1000), rate, "opus"));
		expect(short.at(-1).packets).toHaveLength(2);
		expect(short.at(-1).granule).toBe(312n + 1000n);
		const none = pages(encode(Buffer.alloc(0), rate, "opus"));
		expect(none).toHaveLength(3);
		expect(none[2]).toMatchObject({ flags: 4 });
		expect(none[2].packets).toHaveLength(0);
		const odd = pages(encode(pcm.subarray(0, 961), rate, "opus"));
		expect(odd.at(-1).granule).toBe(312n + 960n);
	});

	it("laces a packet of 255 bytes or more across segments, with a zero segment after an exact multiple", () => {
		const file = page({
			flags: 0,
			granule: 5,
			serial: 1,
			sequence: 3,
			packets: [Buffer.alloc(600, 1), Buffer.alloc(255, 2), Buffer.alloc(10, 3), Buffer.alloc(0)]
		});
		expect([...file.subarray(27, 27 + file[26])]).toEqual([255, 255, 90, 255, 0, 10, 0]);
		const [read] = pages(file);
		expect(read.crc).toBe(true);
		expect(read.packets.map((packet) => packet.length)).toEqual([600, 255, 10, 0]);
	});

	it("says so when Opus cannot take the sample rate", async () => {
		await load("opus");
		expect(() => encode(pcm, 44100, "opus")).toThrow(/Opus takes 8, 12, 16, 24 and 48 kHz audio, not 44100 Hz/);
	});

	it("names the package when an encoder cannot be loaded, and when it was never loaded", async () => {
		for (const [format, name] of [
			["mp3", "wasm-media-encoders"],
			["opus", "opusscript"],
			["flac", "libflacjs"]
		]) {
			const failing = async () => {
				throw new Error("cannot find it");
			};
			await expect(load(format, failing)).rejects.toMatchObject({
				code: "audio_encoder_unavailable",
				status: 501,
				param: "audio.format",
				message: expect.stringContaining(`audio.format "${format}" needs the optional package ${name}`)
			});
			expect(() => encode(pcm, rate, format)).toThrow(/was not loaded/);
		}
		await expect(load("mp3", () => Promise.reject("plain"))).rejects.toThrow(/plain/);
		expect(() => encode(pcm, rate, "aac")).toThrow(/"aac" needs/);
	});
});
