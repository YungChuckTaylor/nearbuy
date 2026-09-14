// TEMPORARY DIAGNOSTIC WRAPPER (same behaviour as the real handler, but any
// crash — at import time or per-request — is returned as readable JSON
// instead of Vercel's opaque FUNCTION_INVOCATION_FAILED page).
// Once the deploy error is identified and fixed, this file goes back to:
//   import { handler } from '../server.js';
//   export default handler;
let mod = null;
let importError = null;
try {
  mod = await import('../server.js');
} catch (e) {
  importError = (e && e.stack) || String(e);
}

export default async function handler(req, res) {
  if (importError) {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ stage: 'import', node: process.version, error: importError }));
    return;
  }
  try {
    return await mod.handler(req, res);
  } catch (e) {
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({
        stage: 'request',
        node: process.version,
        url: req.url,
        vercel: process.env.VERCEL || null,
        error: (e && e.stack) || String(e),
      }));
    } else {
      res.end();
    }
  }
}
