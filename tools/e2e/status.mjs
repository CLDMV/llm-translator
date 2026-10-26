/**
 * @fileoverview Print the models an OpenAI-compatible server lists. Usage: `node tools/e2e/status.mjs <port>`.
 */
const port = process.argv[2] ?? "8100";
const reply = await fetch(`http://127.0.0.1:${port}/v1/models`);
console.log(reply.status, JSON.stringify(await reply.json()));
