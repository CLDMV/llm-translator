/**
 * @fileoverview Setup file loaded only in dist mode (`node tests/run-vitest.mjs --dist`). It fails the run when the
 * src -> dist redirect in .configs/vitest.config.mjs isn't active, so a dist run can't quietly test src/.
 */
import { TranslatorError as fromSrcId } from "../../src/lib/errors.mjs";
import { TranslatorError as fromDistId } from "../../dist/lib/errors.mjs";

// Both ids must be the very same module instance: a module imported from ../../src/ is the one under dist/.
if (fromSrcId !== fromDistId) {
	throw new Error("dist guard: ../../src/lib/errors.mjs did not resolve to dist/lib/errors.mjs, this run would test src/");
}
