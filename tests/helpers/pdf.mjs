/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /tests/helpers/pdf.mjs
 *	@Date: 2026-10-25T12:19:58-07:00 (1792955998)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-10-25T12:59:04-07:00 (1792958344)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

/**
 * Build a tiny but valid PDF (Helvetica text, one line per page) for tests.
 * @param {string[]} pages - Text of each page.
 * @param {string} [title] - Document title.
 * @returns {Uint8Array} PDF bytes.
 */
export function makePdf(pages, title = "Test Doc") {
	const objects = [];
	const add = (body) => objects.push(body);
	add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
	const pagesId = 2 + pages.length * 2;
	const kids = [];
	pages.forEach((text, i) => {
		const stream = `BT /F1 24 Tf 20 100 Td (${text}) Tj ET`;
		add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
		add(
			`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 200 200] /Contents ${2 + i * 2} 0 R /Resources << /Font << /F1 1 0 R >> >> >>`
		);
		kids.push(`${3 + i * 2} 0 R`);
	});
	add(`<< /Type /Pages /Kids [${kids.join(" ")}] /Count ${pages.length} >>`);
	add(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);
	add(`<< /Title (${title}) >>`);
	let out = "%PDF-1.4\n";
	const offsets = [];
	objects.forEach((body, i) => {
		offsets.push(out.length);
		out += `${i + 1} 0 obj\n${body}\nendobj\n`;
	});
	const xref = out.length;
	out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
	out += offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("");
	out += `trailer\n<< /Size ${objects.length + 1} /Root ${pagesId + 1} 0 R /Info ${pagesId + 2} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
	return new TextEncoder().encode(out);
}

/**
 * Base64 of a generated PDF.
 * @param {string[]} pages - Page texts.
 * @param {string} [title] - Title.
 * @returns {string} Base64.
 */
export function pdfBase64(pages, title) {
	return Buffer.from(makePdf(pages, title)).toString("base64");
}
