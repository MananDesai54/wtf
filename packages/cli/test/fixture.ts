import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

const INDEX = `<!doctype html><title>Home</title>
<a id="go" href="/two.html" style="display:block;width:120px;height:40px">Go to Two</a>`;

const TWO = `<!doctype html><title>Two</title>
<button id="spa" style="display:block;width:140px;height:40px"
  onclick="history.pushState({}, '', '/three')">Open Three</button>`;

export function startFixture(): Promise<{ url: string; server: Server }> {
  const server = createServer((req, res) => {
    res.setHeader('content-type', 'text/html');
    if (req.url === '/two.html' || req.url === '/three') res.end(TWO);
    else res.end(INDEX);
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({ url: `http://127.0.0.1:${port}/`, server });
    });
  });
}
