// Simulates the Vercel Node runtime locally: serves server.js's exported
// handler over HTTP exactly like api/handler.js does in a serverless function.
// Usage: VERCEL=1 [KV_REST_API_URL=… KV_REST_API_TOKEN=…] node tools/vercel-sim.mjs [port]
import http from 'node:http';

const { handler } = await import('../server.js');
const port = Number(process.argv[2] || 3201);
http.createServer(handler).listen(port, '127.0.0.1', () => console.log(`vercel-sim listening on ${port}`));
