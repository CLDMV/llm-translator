/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /tests/lib/clienttools.test.vitest.mjs
 *	@Date: 2026-11-22T12:00:00-08:00 (1795464000)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-11-22T12:00:00-08:00 (1795464000)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

import { describe, expect, test } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { emulate } from "../../src/lib/clienttools.mjs";
import { toolsetOf } from "../../src/lib/ids.mjs";

const dir = new URL("../fixtures/client-tools/", import.meta.url);
const fixtures = readdirSync(dir).map((file) => JSON.parse(readFileSync(new URL(file, dir), "utf8")));

describe("schema fixtures", () => {
	test("every published version has one", () => {
		expect(fixtures.map((fixture) => fixture.tool.type).sort()).toEqual([
			"bash_20241022",
			"bash_20250124",
			"computer_20241022",
			"computer_20250124",
			"computer_20251124",
			"computer_toolset_20260801",
			"memory_20250818",
			"text_editor_20241022",
			"text_editor_20250124",
			"text_editor_20250429",
			"text_editor_20250728"
		]);
	});

	test.each(fixtures.map((fixture) => [fixture.tool.type, fixture]))("%s becomes the function tools in its fixture", (_type, fixture) => {
		expect(emulate(fixture.tool)).toEqual(fixture.functions);
	});
});

describe("emulate", () => {
	const names = (tool) => emulate(tool).map((fn) => fn.name);
	const actions = (tool) => emulate(tool)[0].parameters.properties.action.enum;

	test("the function carries the name the client gave the tool, or the tool's own name when it left it out", () => {
		expect(names({ type: "bash_20250124", name: "shell" })).toEqual(["shell"]);
		expect(names({ type: "bash_20250124" })).toEqual(["bash"]);
		expect(names({ type: "bash_20250124", name: "" })).toEqual(["bash"]);
		expect(names({ type: "text_editor_20250124" })).toEqual(["str_replace_editor"]);
		expect(names({ type: "text_editor_20250728" })).toEqual(["str_replace_based_edit_tool"]);
		expect(names({ type: "computer_20250124" })).toEqual(["computer"]);
		expect(names({ type: "memory_20250818" })).toEqual(["memory"]);
	});

	test("undo_edit exists only in the first two text editor versions", () => {
		const commands = (type) => emulate({ type }).at(0).parameters.properties.command.enum;
		expect(commands("text_editor_20241022")).toContain("undo_edit");
		expect(commands("text_editor_20250124")).toContain("undo_edit");
		expect(commands("text_editor_20250429")).not.toContain("undo_edit");
		expect(commands("text_editor_20250728")).toEqual(["view", "create", "str_replace", "insert"]);
	});

	test("max_characters goes into the description, only when it is a positive integer", () => {
		const description = (extra) => emulate({ type: "text_editor_20250728", ...extra })[0].description;
		expect(description({ max_characters: 500 })).toContain("truncated to 500 characters");
		expect(description({})).not.toContain("truncated");
		expect(description({ max_characters: null })).not.toContain("truncated");
		expect(description({ max_characters: 0 })).not.toContain("truncated");
		expect(description({ max_characters: 1.5 })).not.toContain("truncated");
	});

	test("the display options of the computer tool go into the description", () => {
		const description = (extra) => emulate({ type: "computer_20250124", ...extra })[0].description;
		expect(description({ display_width_px: 800, display_height_px: 600, display_number: 0 })).toContain("800 by 600 pixels");
		expect(description({ display_width_px: 800, display_height_px: 600, display_number: 0 })).toContain("display number 0");
		expect(description({ display_width_px: 800 })).not.toContain("pixels");
		expect(description({ display_height_px: 800 })).not.toContain("pixels");
		expect(description({})).not.toContain("display number");
	});

	test("computer actions grow with the version, and zoom follows enable_zoom", () => {
		expect(actions({ type: "computer_20241022" })).toHaveLength(10);
		expect(actions({ type: "computer_20241022" })).not.toContain("scroll");
		expect(actions({ type: "computer_20250124" })).toHaveLength(16);
		expect(actions({ type: "computer_20250124", enable_zoom: true })).not.toContain("zoom");
		expect(actions({ type: "computer_20251124" })).not.toContain("zoom");
		expect(actions({ type: "computer_20251124", enable_zoom: false })).not.toContain("zoom");
		expect(actions({ type: "computer_20251124", enable_zoom: true })).toContain("zoom");
		expect(emulate({ type: "computer_20251124", enable_zoom: true })[0].parameters.properties.region).toBeDefined();
		expect(emulate({ type: "computer_20251124" })[0].parameters.properties.region).toBeUndefined();
	});

	test("the computer toolset is one function per member, minus the ones its configs switch off", () => {
		const all = emulate({ type: "computer_toolset_20260801" });
		expect(all).toHaveLength(17);
		expect(all.every((fn) => fn.toolset === "computer")).toBe(true);
		expect(all.map((fn) => fn.name)).toContain("zoom");
		const some = emulate({
			type: "computer_toolset_20260801",
			configs: { zoom: { enabled: false }, wait: { enabled: false }, key: {}, scroll: null }
		});
		expect(some).toHaveLength(15);
		expect(some.map((fn) => fn.name)).not.toContain("zoom");
		expect(some.map((fn) => fn.name)).toContain("key");
	});

	test("an unknown or future version, a server tool and a plain tool are not emulated", () => {
		expect(emulate({ type: "bash_29990101", name: "bash" })).toBeNull();
		expect(emulate({ type: "computer_toolset_29990101" })).toBeNull();
		expect(emulate({ type: "web_search_20250305", name: "web_search" })).toBeNull();
		expect(emulate({ type: "constructor", name: "x" })).toBeNull();
		expect(emulate({ type: 5 })).toBeNull();
		expect(emulate({ name: "plain" })).toBeNull();
		expect(emulate(undefined)).toBeNull();
	});
});

describe("toolsetOf", () => {
	test("names the toolset of a member and nothing else", () => {
		const state = { toolsets: { left_click: "computer" } };
		expect(toolsetOf(state, "left_click")).toEqual({ toolset_name: "computer" });
		expect(toolsetOf(state, "bash")).toEqual({});
		expect(toolsetOf(state, "toString")).toEqual({});
		expect(toolsetOf({}, "left_click")).toEqual({});
		expect(toolsetOf(undefined, "left_click")).toEqual({});
	});
});
