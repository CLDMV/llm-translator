/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /devcheck.mjs
 *	@Date: 2026-10-24T21:34:06-07:00 (1792902846)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-10-24T21:34:45-07:00 (1792902885)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const srcPath = path.join(__dirname, "src");

// Detect if we're running in a CI environment
const isCI = !!(
	process.env.CI || // Generic CI flag
	process.env.GITHUB_ACTIONS || // GitHub Actions
	process.env.TRAVIS || // Travis CI
	process.env.CIRCLECI || // CircleCI
	process.env.GITLAB_CI || // GitLab CI
	process.env.BUILDKITE || // Buildkite
	process.env.JENKINS_URL || // Jenkins
	process.env.TF_BUILD // Azure DevOps
);

// Skip when installed as a dependency (a `node_modules` segment anywhere above this
// file - covers scoped `node_modules/@cldmv/llm-translator` and unscoped installs). The
// npm-published package ships neither `src/` nor this file, so this branch is already
// moot there; but a git/tarball install DOES include them, and without this guard
// devcheck would `process.exit(1)` inside a consumer's app. A "parent dir ===
// node_modules" check would miss scoped packages (parent is the scope dir).
const isInstalledPackage = __dirname.split(path.sep).includes("node_modules");

// Only meaningful in a source checkout. When `src/` is present the developer should be
// loading from it via the `llm-translator-dev` condition; if that condition isn't set they are
// silently running the built `dist/` copy instead, so warn - even after a build, since
// a built checkout has BOTH src/ and dist/ and the condition is the only thing that
// selects src/.
if (existsSync(srcPath) && !isCI && !isInstalledPackage) {
	// The condition selects src/ (see the `.` export in package.json). It can be
	// supplied via NODE_OPTIONS (`NODE_OPTIONS=--conditions=llm-translator-dev`) OR directly on the
	// node CLI (`node --conditions=llm-translator-dev` / `-C llm-translator-dev`), which lands in execArgv -
	// this is how vitest passes it to workers - so scan both. Each `--conditions`
	// occurrence is ONE literal condition value: Node does not split it on `,` or `|`
	// (verified - `--conditions=llm-translator-dev,x` and `--conditions=llm-translator-dev|x` do NOT enable
	// `llm-translator-dev`), and multiple conditions are passed as repeated flags. So collect each
	// value whole and match EXACTLY - no substring, no splitting - so `not-llm-translator-dev`,
	// `llm-translator-dev,x`, and `llm-translator-dev|production` all correctly fail to count. Namespaced
	// (not the generic `development`) so a consuming app's own `--conditions=development`
	// can't flip this package to a source tree it doesn't ship. NODE_ENV is deliberately
	// NOT consulted: it does not affect which tree resolves.
	const conditions = [];
	const scan = (tokens) => {
		for (let i = 0; i < tokens.length; i++) {
			if (tokens[i] === "--conditions" || tokens[i] === "-C") {
				// Space form (`--conditions x` / `-C x`): consume the following token as this
				// flag's value and SKIP it, so a value that itself looks like a flag (e.g. the
				// literal `--conditions=x`) isn't re-interpreted on the next iteration.
				if (tokens[i + 1] !== undefined) {
					conditions.push(tokens[i + 1]);
					i++;
				}
			} else if (tokens[i].startsWith("--conditions=")) {
				conditions.push(tokens[i].slice("--conditions=".length));
			}
			// Note: `-C=x` is intentionally not handled - Node rejects it ("bad option"),
			// so it can never appear in execArgv/NODE_OPTIONS. Valid forms are
			// `--conditions=x`, `--conditions x`, and `-C x`.
		}
	};
	scan(process.execArgv);
	scan((process.env.NODE_OPTIONS || "").split(/\s+/).filter(Boolean));
	const hasDevCondition = conditions.includes("llm-translator-dev");

	if (!hasDevCondition) {
		console.error("❌ Development environment not properly configured!");
		console.error("📁 Source folder detected but the 'llm-translator-dev' condition is not set,");
		console.error("   so imports resolve to dist/ by default (or fail if it isn't built) instead of src/.");
		console.error("");
		console.error("🔧 To load from src/ for development, set the condition:");
		console.error("   Windows (cmd):");
		console.error("     set NODE_OPTIONS=--conditions=llm-translator-dev");
		console.error("");
		console.error("   Windows (PowerShell):");
		console.error("     $env:NODE_OPTIONS='--conditions=llm-translator-dev'");
		console.error("");
		console.error("   Unix/Linux/macOS:");
		console.error("     export NODE_OPTIONS=--conditions=llm-translator-dev");
		console.error("");
		console.error("   ...or pass it directly: node --conditions=llm-translator-dev <file>");
		console.error("");
		console.error("💡 'llm-translator-dev' is namespaced so it can't conflict with a consumer's own");
		console.error("   development conditions.");
		console.error("🚀 CI environments automatically skip this check.");
		process.exit(1);
	}
}
