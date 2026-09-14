// Vercel serverless entry point — the exact same handler as `node server.js`.
// vercel.json rewrites EVERY path here; the handler serves the PWA statically
// from public/ and routes /api/*, /pay/*, /webhooks/* itself. State persists
// via Vercel KV when attached (docs/VERCEL.md); without KV the demo reseeds
// on cold starts.
import { handler } from '../server.js';

export default handler;
