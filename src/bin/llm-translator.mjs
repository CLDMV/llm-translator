#!/usr/bin/env node
/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/bin/llm-translator.mjs
 *	@Date: 2026-10-25T12:29:36-07:00 (1792956576)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-10-25T12:59:01-07:00 (1792958341)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

/**
 * @fileoverview `llm-translator` executable.
 * @module @cldmv/llm-translator/bin
 */
import { main } from "../lib/cli.mjs";

process.exitCode = await main(process.argv.slice(2));
