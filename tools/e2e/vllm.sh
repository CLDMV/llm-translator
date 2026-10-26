#!/bin/bash
# Start vLLM (CPU build) in Docker for end-to-end runs, bound to 127.0.0.1 only. See docs/testing.md.
#
# Layout under $E2E_DIR (default <repo>/tmp/e2e): models/<name> holds the model files (read-only mount), hf/ and vllmcache/
# are caches that make later starts faster.
#
# Environment: E2E_DIR, MODEL (directory name under models/, default Qwen3-1.7B), SERVED (served model name, default
# qwen3-1.7b), DTYPE (default bfloat16), PORT (default 8100), MEMORY (default 20g), CPUSET (default 0-7),
# THREADS (OpenMP thread binding, default 0-3), KVCACHE (GiB for the KV cache, default 8), IMAGE.
set -euo pipefail
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
DIR=${E2E_DIR:-$HERE/../../tmp/e2e}
mkdir -p "$DIR/models" "$DIR/hf" "$DIR/vllmcache"
DIR=$(cd "$DIR" && pwd)
NAME=${NAME:-llmt-vllm}

docker rm -f "$NAME" > /dev/null 2>&1 || true
# The three timeout variables are essential on a slow machine: vLLM's defaults (300 s for one engine step) kill the engine
# during a long CPU prefill, which looks like a crash halfway through a request.
exec docker run -d --name "$NAME" \
	-p "127.0.0.1:${PORT:-8100}:8000" \
	--shm-size=4g \
	--memory="${MEMORY:-20g}" --memory-swap="${MEMORY:-20g}" \
	--cpuset-cpus="${CPUSET:-0-7}" \
	--cap-add SYS_NICE --security-opt seccomp=unconfined \
	-v "$DIR/models:/models:ro" \
	-v "$DIR/hf:/root/.cache/huggingface" \
	-v "$DIR/vllmcache:/root/.cache/vllm" \
	-e HF_HUB_OFFLINE=1 \
	-e VLLM_EXECUTE_MODEL_TIMEOUT_SECONDS=14400 -e VLLM_ENGINE_ITERATION_TIMEOUT_S=7200 -e VLLM_RPC_TIMEOUT=7200000 \
	-e VLLM_CPU_KVCACHE_SPACE="${KVCACHE:-8}" \
	-e VLLM_CPU_OMP_THREADS_BIND="${THREADS:-0-3}" \
	"${IMAGE:-vllm/vllm-openai-cpu:v0.32.0-x86_64}" \
	--model "/models/${MODEL:-Qwen3-1.7B}" \
	--served-model-name "${SERVED:-qwen3-1.7b}" \
	--dtype "${DTYPE:-bfloat16}" \
	--max-model-len 32768 --max-num-batched-tokens 1024 --max-num-seqs 2 \
	--enable-auto-tool-choice --tool-call-parser hermes \
	--reasoning-parser qwen3 \
	--enable-prompt-tokens-details
