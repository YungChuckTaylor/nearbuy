// Minimal Upstash REST API stub — lets us exercise the Vercel KV storage mode
// locally: implements the two commands server.js uses (GET / SET) over HTTP.
// Usage: node tools/kv-stub.mjs [port]
import http from 'node:http';

const store = new Map();
http.createServer((req, res) => {
  let b = '';
  req.on('data', (c) => (b += c));
  req.on('end', () => {
    try {
      const cmd = JSON.parse(b);
      let result = null;
      if (cmd[0] === 'GET') result = store.has(cmd[1]) ? store.get(cmd[1]) : null;
      else if (cmd[0] === 'SET') { store.set(cmd[1], cmd[2]); result = 'OK'; }
      else throw new Error('unsupported command ' + cmd[0]);
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ result }));
    } catch (e) {
      res.statusCode = 400;
      res.end(JSON.stringify({ error: e.message }));
    }
  });
}).listen(Number(process.argv[2] || 3110), '127.0.0.1', () => console.log('kv-stub ready'));
