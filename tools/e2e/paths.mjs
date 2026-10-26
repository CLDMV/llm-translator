/**
 * @fileoverview Shared locations for the end-to-end harness. Everything lives under `E2E_DIR` (default `<repo>/tmp/e2e`, which is gitignored).
 */
import { fileURLToPath } from "node:url";
import path from "node:path";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Scratch root for models, logs, the isolated Claude Code HOME and the scratch project. */
export const dir = path.resolve(process.env.E2E_DIR ?? path.join(repo, "tmp", "e2e"));

/** Directory Claude Code runs in (its working directory and the files the scenarios read and write). */
export const work = path.join(dir, "cc-work");

/** Directory for logs written by the harness. */
export const logs = path.join(dir, "logs");
