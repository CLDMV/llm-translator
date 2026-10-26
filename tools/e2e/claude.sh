#!/bin/bash
# Run Claude Code against the translator inside an ISOLATED home, so a scenario never touches the real ~/.claude, its
# credentials or its history. Usage:
#
#   tools/e2e/claude.sh <log-name> [VAR=value ...] -- <claude arguments...>
#
# stdout, stderr and the exit code go to $E2E_DIR/logs/<log-name>.{out,err,exit}.
#
# Environment: E2E_DIR (default <repo>/tmp/e2e), PORT (translator port, default 8787), MODEL (model name the translator
# serves, default qwen3-1.7b), CLAUDE_BIN (default `claude` from PATH).
#
# `--dangerously-skip-permissions` is passed ONLY by callers that opt in, and only makes sense here: the working directory is
# the throwaway project $E2E_DIR/cc-work and HOME is the scratch home, so an unattended tool call can only touch scratch files.
# Never add it to a run that uses a real HOME or a real project.
set -uo pipefail
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
DIR=${E2E_DIR:-$HERE/../../tmp/e2e}
mkdir -p "$DIR/cc-home" "$DIR/cc-work" "$DIR/logs"
DIR=$(cd "$DIR" && pwd)
model=${MODEL:-qwen3-1.7b}

name=${1:?usage: claude.sh <log-name> [VAR=value ...] -- <claude arguments...>}
shift
extra=()
while [ "${1:-}" != "--" ]; do
	[ $# -gt 0 ] || { echo "missing -- before the claude arguments" >&2; exit 2; }
	extra+=("$1")
	shift
done
shift

cd "$DIR/cc-work" || exit 1
# `env -i` drops every inherited variable (API keys, the real HOME, proxy settings); only what is listed below is visible.
# API_TIMEOUT_MS is generous because a CPU model needs minutes per turn.
env -i PATH="$PATH" \
	HOME="$DIR/cc-home" XDG_CONFIG_HOME="$DIR/cc-home/.config" XDG_DATA_HOME="$DIR/cc-home/.local/share" XDG_CACHE_HOME="$DIR/cc-home/.cache" \
	ANTHROPIC_BASE_URL="http://127.0.0.1:${PORT:-8787}" ANTHROPIC_AUTH_TOKEN=test ANTHROPIC_MODEL="$model" \
	ANTHROPIC_DEFAULT_OPUS_MODEL="$model" ANTHROPIC_DEFAULT_SONNET_MODEL="$model" ANTHROPIC_DEFAULT_HAIKU_MODEL="$model" \
	API_TIMEOUT_MS=3600000 CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1 DISABLE_AUTOUPDATER=1 CLAUDE_CODE_MAX_OUTPUT_TOKENS=4096 \
	"${extra[@]}" "${CLAUDE_BIN:-claude}" "$@" > "$DIR/logs/$name.out" 2> "$DIR/logs/$name.err"
code=$?
echo "$code" > "$DIR/logs/$name.exit"
exit "$code"
