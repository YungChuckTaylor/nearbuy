// Vercel serverless entry point — the exact same handler as `node server.js`.
// vercel.json rewrites /api/*, /pay/* and /webhooks/* here; everything else is
// served statically from public/. State persists via Vercel KV when attached
// (see docs/VERCEL.md); without KV the demo reseeds on every cold start.
import { handler } from '../server.js';

export default handler;
