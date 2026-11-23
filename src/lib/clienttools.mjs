/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/lib/clienttools.mjs
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

/**
 * @fileoverview Anthropic's client tools (`bash`, `text_editor`, `computer`, `memory`) as plain function tools.
 *
 * These tools have no `input_schema` in a request: the model that runs them has the schema built in. A server that is not Anthropic's has no
 * such model, so the translator offers it a function tool with the input fields Anthropic documents for each tool. The function carries the
 * name the client gave the tool (`bash`, `str_replace_based_edit_tool`, ...), so a call the server makes already reads as a call of the typed
 * tool, and the client runs it as it would run Anthropic's. Descriptions are written here; Anthropic does not publish its own.
 *
 * `computer_toolset_20260801` is the exception that has no single name: each member (`left_click`, `key`, ...) is its own function, and a call
 * of one is returned with `toolset_name: "computer"`.
 * @module @cldmv/llm-translator/lib/clienttools
 */

const STRING = { type: "string" };
const INTEGER = { type: "integer" };

/** An `[x, y]` pair of pixels. */
const POINT = { type: "array", items: INTEGER, minItems: 2, maxItems: 2 };

/**
 * An object schema.
 * @param {Record<string, any>} properties - Property schemas.
 * @param {string[]} [required] - Required property names.
 * @returns {any} Schema.
 */
function object(properties, required = []) {
	return required.length > 0 ? { type: "object", properties, required } : { type: "object", properties };
}

/**
 * A string enum.
 * @param {string[]} values - Allowed values.
 * @param {string} description - What the field is.
 * @returns {any} Schema.
 */
function choice(values, description) {
	return { type: "string", enum: values, description };
}

/** The tool name each family uses when a request leaves it out. */
const DEFAULT_NAMES = {
	bash: "bash",
	memory: "memory",
	computer: "computer",
	editor: "str_replace_based_edit_tool",
	legacyEditor: "str_replace_editor"
};

/** @type {Record<string, any>} */
const BASH = {
	name: DEFAULT_NAMES.bash,
	build: () => ({
		description:
			"Run a command in a persistent bash session. Working directory, environment variables and files carry over between calls. Set restart to true to start a fresh session.",
		parameters: object({
			command: { ...STRING, description: "The bash command to run. Required unless restart is true." },
			restart: { type: "boolean", description: "Set to true to restart the bash session." }
		})
	})
};

/**
 * Text editor tool builder.
 * @param {string} name - Default tool name.
 * @param {boolean} undo - Whether the version has `undo_edit`.
 * @returns {any} Entry.
 */
function editor(name, undo) {
	const commands = ["view", "create", "str_replace", "insert", ...(undo ? ["undo_edit"] : [])];
	return {
		name,
		build: (tool) => {
			let description =
				"View, create and edit text files. Commands: view (a file or a directory listing; view_range limits it to a line range), create (a new file with file_text), str_replace (replace old_str, which must match exactly once, with new_str), insert (insert_text after line insert_line; 0 is the start of the file)";
			if (undo) description += ", undo_edit (undo the last edit of the file)";
			description += ".";
			if (Number.isInteger(tool.max_characters) && tool.max_characters > 0) {
				description += ` Views of a file are truncated to ${tool.max_characters} characters.`;
			}
			return {
				description,
				parameters: object(
					{
						command: choice(commands, "The command to run."),
						path: { ...STRING, description: "The file or directory the command applies to." },
						view_range: {
							type: "array",
							items: INTEGER,
							minItems: 2,
							maxItems: 2,
							description: "view only: [start_line, end_line], 1-indexed; an end line of -1 reads to the end of the file."
						},
						old_str: { ...STRING, description: "str_replace only: the text to replace, matched exactly, including whitespace." },
						new_str: { ...STRING, description: "str_replace only: the text to put in its place." },
						file_text: { ...STRING, description: "create only: the content of the new file." },
						insert_line: { ...INTEGER, description: "insert only: the line after which to insert; 0 inserts at the start of the file." },
						insert_text: { ...STRING, description: "insert only: the text to insert." }
					},
					["command", "path"]
				)
			};
		}
	};
}

/** @type {Record<string, any>} */
const MEMORY = {
	name: DEFAULT_NAMES.memory,
	build: () => ({
		description:
			"Store and retrieve notes across conversations in files under /memories. Commands: view (a directory or file, optionally a line range), create (a file with file_text), str_replace, insert (after line insert_line), delete (a file or directory) and rename (old_path to new_path). Check the directory before starting a task.",
		parameters: object(
			{
				command: choice(["view", "create", "str_replace", "insert", "delete", "rename"], "The command to run."),
				path: { ...STRING, description: "The file or directory the command applies to (view, create, str_replace, insert, delete)." },
				view_range: {
					type: "array",
					items: INTEGER,
					minItems: 2,
					maxItems: 2,
					description: "view only: [start_line, end_line], 1-indexed; an end line of -1 reads to the end of the file."
				},
				file_text: { ...STRING, description: "create only: the content of the file." },
				old_str: { ...STRING, description: "str_replace only: the text to replace, matched exactly." },
				new_str: { ...STRING, description: "str_replace only: the replacement; leave it out to delete old_str." },
				insert_line: { ...INTEGER, description: "insert only: the line after which to insert; 0 inserts at the start of the file." },
				insert_text: { ...STRING, description: "insert only: the text to insert." },
				old_path: { ...STRING, description: "rename only: the path to rename." },
				new_path: { ...STRING, description: "rename only: the new path." }
			},
			["command"]
		)
	})
};

/** The actions of `computer_20241022`. */
const ACTIONS_2024 = [
	"key",
	"type",
	"mouse_move",
	"left_click",
	"left_click_drag",
	"right_click",
	"middle_click",
	"double_click",
	"screenshot",
	"cursor_position"
];

/** The actions `computer_20250124` adds. */
const ACTIONS_2025 = ["left_mouse_down", "left_mouse_up", "scroll", "hold_key", "wait", "triple_click"];

/**
 * Computer tool builder (one function with an `action` field).
 * @param {string[]} base - The actions of the version.
 * @param {boolean} [zoomOption] - Whether the version has `zoom`, which its `enable_zoom` option turns on.
 * @returns {any} Entry.
 */
function computer(base, zoomOption = false) {
	return {
		name: DEFAULT_NAMES.computer,
		build: (tool) => {
			const actions = zoomOption && tool.enable_zoom === true ? [...base, "zoom"] : base;
			let description = "Control a computer's screen, mouse and keyboard. Choose an action; take a screenshot to see the screen.";
			if (Number.isInteger(tool.display_width_px) && Number.isInteger(tool.display_height_px)) {
				description += ` The display is ${tool.display_width_px} by ${tool.display_height_px} pixels; coordinates are pixels from the top left corner.`;
			}
			if (Number.isInteger(tool.display_number)) description += ` It is X display number ${tool.display_number}.`;
			const parameters = {
				action: choice(actions, "The action to take."),
				coordinate: { ...POINT, description: "[x, y] in pixels: where to click, move to or scroll (and where a drag ends)." },
				text: {
					...STRING,
					description:
						"The text to type (type), the key or key combination such as ctrl+s (key, hold_key), or modifier keys held during a click or scroll."
				},
				start_coordinate: { ...POINT, description: "left_click_drag only: [x, y] where the drag starts." },
				scroll_direction: choice(["up", "down", "left", "right"], "scroll only: the direction."),
				scroll_amount: { ...INTEGER, description: "scroll only: how far to scroll, in scroll clicks." },
				duration: { type: "number", description: "hold_key and wait only: seconds." }
			};
			if (actions.length > base.length) {
				parameters.region = {
					type: "array",
					items: INTEGER,
					minItems: 4,
					maxItems: 4,
					description: "zoom only: [x0, y0, x1, y1] of the region to capture at full resolution."
				};
			}
			return { description, parameters: object(parameters, ["action"]) };
		}
	};
}

const CLICK = {
	coordinate: { ...POINT, description: "[x, y] in pixels; the cursor's position when left out." },
	text: { ...STRING, description: "Modifier keys to hold during the click, such as shift." }
};

/** The members of `computer_toolset_20260801`: each is a function of its own. */
const MEMBERS = {
	screenshot: ["Capture the full display as an image.", object({})],
	zoom: [
		"Capture a region of the display at full resolution.",
		object({ region: { type: "array", items: INTEGER, minItems: 4, maxItems: 4, description: "[x0, y0, x1, y1] in pixels." } }, ["region"])
	],
	left_click: ["Left click.", object(CLICK)],
	right_click: ["Right click.", object(CLICK)],
	middle_click: ["Middle click.", object(CLICK)],
	double_click: ["Double click.", object(CLICK)],
	triple_click: ["Triple click.", object(CLICK)],
	left_click_drag: [
		"Press at start_coordinate, drag to coordinate and release.",
		object(
			{
				start_coordinate: { ...POINT, description: "[x, y] where the drag starts." },
				coordinate: { ...POINT, description: "[x, y] where the drag ends." },
				text: CLICK.text
			},
			["start_coordinate", "coordinate"]
		)
	],
	mouse_move: ["Move the cursor without clicking.", object({ coordinate: { ...POINT, description: "[x, y] in pixels." } }, ["coordinate"])],
	left_mouse_down: ["Press the left mouse button at the cursor.", object({})],
	left_mouse_up: ["Release the left mouse button at the cursor.", object({})],
	cursor_position: ["Report the cursor position.", object({})],
	scroll: [
		"Scroll at a position, or at the cursor when none is given.",
		object(
			{
				scroll_direction: choice(["up", "down", "left", "right"], "The direction."),
				scroll_amount: { type: "number", description: "How far to scroll, in scroll clicks." },
				coordinate: CLICK.coordinate,
				text: { ...STRING, description: "Modifier keys to hold while scrolling." }
			},
			["scroll_direction", "scroll_amount"]
		)
	],
	type: ["Type literal text at the keyboard focus.", object({ text: { ...STRING, description: "The text to type." } }, ["text"])],
	key: [
		"Press a key or key combination, such as ctrl+s.",
		object(
			{
				text: { ...STRING, description: "The key, or keys joined with +." },
				repeat: { ...INTEGER, minimum: 1, maximum: 100, description: "How many times to press it; 1 when left out." }
			},
			["text"]
		)
	],
	hold_key: [
		"Hold a key or key combination for a number of seconds.",
		object(
			{
				text: { ...STRING, description: "The key, or keys joined with +." },
				duration: { type: "number", maximum: 300, description: "Seconds, up to 300." }
			},
			["text", "duration"]
		)
	],
	wait: [
		"Wait before the next action.",
		object({ duration: { type: "number", maximum: 300, description: "Seconds, up to 300." } }, ["duration"])
	]
};

/** The toolset the members belong to; a call of a member is returned with this as `toolset_name`. */
export const TOOLSET = "computer";

/** Single tools by type string: every published version. Anything else is not a tool the translator knows. */
const SINGLE = Object.freeze({
	bash_20241022: BASH,
	bash_20250124: BASH,
	text_editor_20241022: editor(DEFAULT_NAMES.legacyEditor, true),
	text_editor_20250124: editor(DEFAULT_NAMES.legacyEditor, true),
	text_editor_20250429: editor(DEFAULT_NAMES.editor, false),
	text_editor_20250728: editor(DEFAULT_NAMES.editor, false),
	computer_20241022: computer(ACTIONS_2024),
	computer_20250124: computer([...ACTIONS_2024, ...ACTIONS_2025]),
	computer_20251124: computer([...ACTIONS_2024, ...ACTIONS_2025], true),
	memory_20250818: MEMORY
});
/** The computer toolset's type string. */
const TOOLSET_TYPE = "computer_toolset_20260801";

/**
 * The function tools that stand for one of Anthropic's client tools.
 * @param {any} tool - A tool of the request that has a `type`.
 * @returns {{ name: string, description: string, parameters: any, toolset?: string }[] | null} The functions (one, or the members of the toolset), or null when the type is not a client tool the translator knows (a server tool, or a version it has no schema for).
 */
export function emulate(tool) {
	const type = tool?.type;
	if (type === TOOLSET_TYPE) {
		const off = new Set(
			Object.entries(tool.configs ?? {})
				.filter(([, config]) => config?.enabled === false)
				.map(([member]) => member)
		);
		return Object.entries(MEMBERS)
			.filter(([member]) => !off.has(member))
			.map(([member, [description, parameters]]) => ({ name: member, description, parameters, toolset: TOOLSET }));
	}
	if (typeof type !== "string" || !Object.hasOwn(SINGLE, type)) return null;
	const entry = SINGLE[type];
	return [{ name: typeof tool.name === "string" && tool.name !== "" ? tool.name : entry.name, ...entry.build(tool) }];
}
