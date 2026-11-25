/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /tests/lib/html-text.test.vitest.mjs
 *	@Date: 2026-11-25T01:00:00-08:00 (1795596800)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-11-25T01:00:00-08:00 (1795596800)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

/**
 * @fileoverview HTML to text: hidden elements, block breaks, entities, white space and the malformed markup a real page has.
 */
import { describe, expect, it } from "vitest";
import { decode, htmlToText } from "../../src/lib/html-text.mjs";

describe("decode", () => {
	it("decodes named, decimal and hex references and leaves unknown or invalid ones alone", () => {
		expect(decode("a &amp; b &LT;c&gt; &quot;d&quot; &#65;&#x42; &unknown; &#0; &#xD800; &#1114112;")).toBe(
			'a & b <c> "d" AB &unknown; &#0; &#xD800; &#1114112;'
		);
	});
});

describe("htmlToText", () => {
	it("returns the title and the readable text, with block elements on their own lines", () => {
		const html = `<!doctype html><html><head><title> My &amp; Page </title><style>p { color: red }</style><script>var a = "<p>";</script></head>
			<body><h1>Heading</h1><p>One <b>bold</b>   word</p><ul><li>a</li><li>b</li></ul><div>x</div></body></html>`;
		expect(htmlToText(html)).toEqual({ title: "My & Page", text: "Heading\nOne bold word\na\nb\nx" });
	});

	it("drops comments, processing instructions, hidden elements and closing block tags' text noise", () => {
		const html = `<?xml version="1.0"?><!-- <p>no</p> --><p>a</p><noscript>nope</noscript><SCRIPT>x</SCRIPT ><p>b</p>`;
		expect(htmlToText(html).text).toBe("a\nb");
	});

	it("keeps a stray less-than sign and a less-than sign before a closing slash that is not a tag", () => {
		expect(htmlToText("1 < 2 and </ 3 <3").text).toBe("1 < 2 and </ 3 <3");
	});

	it("uses only the first title and no title when it is empty or absent", () => {
		expect(htmlToText("<title>One</title><title>Two</title><svg><title>Three</title></svg>text").title).toBe("One");
		expect(htmlToText("<title>  </title>text").title).toBeNull();
		expect(htmlToText("plain").title).toBeNull();
		expect(htmlToText("<title>a<b>c</b></title>").title).toBe("ac");
		expect(htmlToText("<title>a > b <i</title>").title).toBe("a b");
	});

	it("treats an unclosed comment, tag, hidden element or title as the end of the page", () => {
		expect(htmlToText("a<!-- never closed").text).toBe("a");
		expect(htmlToText("a<p class='x'").text).toBe("a");
		expect(htmlToText("a<script>never closed").text).toBe("a");
		expect(htmlToText("a<script>x</script").text).toBe("a");
		expect(htmlToText("a<!doctype html").text).toBe("a");
		expect(htmlToText("<title>never closed").title).toBe("never closed");
	});

	it("keeps the indexes right for text whose lower-case form is longer", () => {
		expect(htmlToText("\u0130<P>a</P><SCRIPT>x</SCRIPT>b").text).toBe("\u0130\na\nb");
	});

	it("collapses white space and keeps at most one blank line", () => {
		expect(htmlToText("<p>a</p>\n\n\n\n<p>  b \t c  </p><br><br><br>d").text).toBe("a\n\nb c\nd");
	});
});
