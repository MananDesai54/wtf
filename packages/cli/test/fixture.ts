import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

const INDEX = `<!doctype html><title>Home</title>
<a id="go" href="/two.html" style="display:block;width:120px;height:40px">Go to Two</a>
<a id="blank" href="/two.html" target="_blank" style="display:block;width:160px;height:40px">Open Two New Tab</a>
<button id="modal" style="display:block;width:120px;height:40px"
  onclick="document.getElementById('m').style.display='block'">Open Modal</button>
<div id="m" style="display:none;width:200px;height:100px;background:#eee">MODAL CONTENT</div>`;

const TWO = `<!doctype html><title>Two</title>
<button id="spa" style="display:block;width:140px;height:40px"
  onclick="history.pushState({}, '', '/three')">Open Three</button>
<button id="spa2" style="display:block;width:140px;height:40px"
  onclick="history.pushState({}, '', '/four')">Open Four</button>`;

// 1x1 red PNG
export const RED_PIXEL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const RICH = `<!doctype html><title>Rich</title>
<body style="margin:0">
<h1 id="hd" style="font-size:32px;font-weight:700;text-align:center">Heading Text</h1>
<p id="para">Paragraph content here</p>
<button id="btn" style="background:#2f7cf6;color:#fff;border-radius:6px;border:0;padding:10px 20px">Click Me</button>
<img id="pic" src="${RED_PIXEL}" width="50" height="50">
<svg id="vec" width="40" height="40"><circle cx="20" cy="20" r="15"/></svg>
<div id="hidden" style="display:none">Invisible text</div>
<div id="wrapme" style="width:120px">This is a longer sentence that definitely wraps onto multiple lines</div>
<div id="deep" style="position:absolute;top:2000px;left:10px">Below fold text</div>
</body>`;

export function startFixture(): Promise<{ url: string; server: Server }> {
  const server = createServer((req, res) => {
    res.setHeader('content-type', 'text/html');
    if (req.url === '/rich.html') res.end(RICH);
    else if (req.url === '/two.html' || req.url === '/three') res.end(TWO);
    else res.end(INDEX);
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({ url: `http://127.0.0.1:${port}/`, server });
    });
  });
}
