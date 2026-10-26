# Testing

## Unit and integration tests

`npm test` runs the vitest suite followed by the built-package check, and `npm run coverage` is the full gate (100% of `src/`, no ignore pragmas). Tests live under `tests/`, run against fake upstreams (`tests/helpers/fake-server.mjs`) and never need a model. Targeted runs go through the runner: `npm run coverage` or `node tests/run-vitest.mjs <pattern>`.

## End-to-end harness against a real model

`tools/e2e/` holds the scripts used to run the translator against a real vLLM and a real Claude Code. The folder is not part of the npm package (`files` ships only `dist/` and `types/`) and coverage only measures `src/`. Everything the scripts create lives under `E2E_DIR`, by default `tmp/e2e` (gitignored): `models/`, `hf/` and `vllmcache/` for vLLM, `logs/`, an isolated Claude Code home in `cc-home/` and the scratch project in `cc-work/`.

| Script                        | Purpose                                                                                                                                                           |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tools/e2e/vllm.sh`           | Starts vLLM (CPU build) in Docker on `127.0.0.1:8100`.                                                                                                            |
| `tools/e2e/fake-vllm.mjs`     | A scripted vLLM-like server (port `FAKE_PORT`, default 8102) that answers the probes and replays Read/Write tool calls. `FAKE_DELAY_MS` delays every chat answer. |
| `tools/e2e/log-proxy.mjs`     | Reverse proxy `LISTEN` (8101) to `TARGET` (8100) that logs every request and response body to `logs/<LOG>.jsonl`.                                                 |
| `tools/e2e/claude.sh`         | Runs Claude Code with an isolated home against the translator and stores stdout, stderr and the exit code in `logs/`.                                             |
| `tools/e2e/status.mjs <port>` | Prints `/v1/models` of a server, to check that it is up.                                                                                                          |

### Running vLLM on a CPU

Put the model files in `tmp/e2e/models/<name>` (for example `Qwen3-1.7B`; downloading with the host's `curl` or `huggingface-cli` is far faster than letting the container fetch them), then:

```bash
tools/e2e/vllm.sh                 # MODEL=Qwen3-1.7B SERVED=qwen3-1.7b by default
node tools/e2e/status.mjs 8100    # answers once the model is loaded
```

The script runs this command (image `vllm/vllm-openai-cpu:v0.32.0-x86_64`, which needs AVX2):

```bash
docker run -d --name llmt-vllm \
  -p 127.0.0.1:8100:8000 --shm-size=4g \
  --memory=20g --memory-swap=20g --cpuset-cpus=0-7 \
  --cap-add SYS_NICE --security-opt seccomp=unconfined \
  -v "$E2E_DIR/models:/models:ro" -v "$E2E_DIR/hf:/root/.cache/huggingface" -v "$E2E_DIR/vllmcache:/root/.cache/vllm" \
  -e HF_HUB_OFFLINE=1 \
  -e VLLM_EXECUTE_MODEL_TIMEOUT_SECONDS=14400 -e VLLM_ENGINE_ITERATION_TIMEOUT_S=7200 -e VLLM_RPC_TIMEOUT=7200000 \
  -e VLLM_CPU_KVCACHE_SPACE=8 -e VLLM_CPU_OMP_THREADS_BIND=0-3 \
  vllm/vllm-openai-cpu:v0.32.0-x86_64 \
  --model /models/Qwen3-1.7B --served-model-name qwen3-1.7b --dtype bfloat16 \
  --max-model-len 32768 --max-num-batched-tokens 1024 --max-num-seqs 2 \
  --enable-auto-tool-choice --tool-call-parser hermes --reasoning-parser qwen3 --enable-prompt-tokens-details
```

Notes from running it on a loaded machine:

- The three `VLLM_*_TIMEOUT` variables matter. vLLM kills its engine when one step takes longer than 300 seconds, and a Claude Code request (a system prompt plus around 20 tool schemas, tens of thousands of tokens) takes far longer than that to prefill on a CPU. The values above allow hours.
- `--max-num-batched-tokens 1024 --max-num-seqs 2` shorten the warm-up compile. Keep the memory limit above the model size plus the KV cache (`VLLM_CPU_KVCACHE_SPACE`, in GiB); if the host swaps, weights get paged out and every request slows down further.
- Prefill ran at roughly 10 tokens per second for a 1.7B model on a shared 4-core slice, so a full-size Claude Code turn takes 20 to 40 minutes. The harness is for correctness, not for timing.
- Do not restart the container to fix a slow request; the compile cache in `vllmcache/` is reused, but the warm-up still costs minutes.

### The stream watchdog lesson

Claude Code aborts and retries a request when no streaming event arrives for 300 seconds (a warning at 150 seconds). `event: ping` does not count: only real events such as `content_block_delta` reset the timer. vLLM sends response headers with the first token, so a long prefill leaves the connection silent, and a retry restarts the prefill from scratch, which on a CPU never converges. Two things in the translator exist because of this: the transport has no timeouts (Node's `fetch` gives up on missing headers after 300 seconds), and the server commits to the stream early with `message_start`, an empty thinking block and empty-delta keep-alives (see [server.md](server.md) and decision D-24 in [decisions.md](decisions.md)). `FAKE_DELAY_MS=700000 node tools/e2e/fake-vllm.mjs` reproduces the situation in a few minutes without a model.

### Running the Claude Code scenarios

```bash
node --conditions=llm-translator-dev src/bin/llm-translator.mjs --upstream http://127.0.0.1:8100 --port 8787 &
mkdir -p tmp/e2e/cc-work && printf 'Project notes\n' > tmp/e2e/cc-work/notes.txt

tools/e2e/claude.sh plain -- -p "What is the capital of France?" --output-format json
tools/e2e/claude.sh notes -- -p "Read notes.txt and summarise it" --output-format json --dangerously-skip-permissions
tools/e2e/claude.sh again -- -p "And in one word?" --continue --output-format json
```

Scenarios worth running: a plain question, a Read tool loop, a Write, `--continue`, thinking, a Read of a small PDF (page text and, for a multimodal model, page images), and the default tool search against `ENABLE_TOOL_SEARCH=false` (pass it as `VAR=value` before the `--`). To see what the model actually received, put `log-proxy.mjs` between the translator and vLLM (`--upstream http://127.0.0.1:8101`) and read `tmp/e2e/logs/upstream.jsonl`.

Isolation rules the scripts enforce, and callers must keep:

- `claude.sh` runs `env -i` with `HOME` and the XDG directories pointing into `tmp/e2e/cc-home`, so the run never reads or modifies a real Claude Code configuration, credentials or history.
- `--dangerously-skip-permissions` is never added by the scripts. It is only acceptable in this setup, where the working directory is the throwaway `cc-work` project and the home is scratch; an unattended tool call can then only touch scratch files.
- Stop the translator, the proxy and the fake server when done (select their PIDs explicitly; a pattern-matching `pkill -f` can match its own shell). Leave the vLLM container running or remove it with `docker rm -f llmt-vllm`.
