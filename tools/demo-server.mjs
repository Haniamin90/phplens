// Local demo server that imitates servers with different PHP version banners so you can
// see every PHPLens state in your own browser. It serves static HTML only.
// Usage: node tools/demo-server.mjs  ->  http://127.0.0.1:8099/
import { createServer } from 'node:http';

const PORT = Number(process.env.PORT || 8099);

const ROUTES = {
  '/vulnerable': { headers: { 'X-Powered-By': 'PHP/8.4.26' }, label: 'Unpatched 8.4.26 (Danger)' },
  '/eol':        { headers: { 'X-Powered-By': 'PHP/7.4.33', 'Server': 'Apache/2.4.41 (Ubuntu)' }, label: 'End-of-life 7.4 (Danger)' },
  '/distro':     { headers: { 'X-Powered-By': 'PHP/8.1.2-1ubuntu2.19' }, label: 'Distro build 8.1.2-1ubuntu (Caution/Danger – EOL branch)' },
  '/distro82':   { headers: { 'Server': 'Apache/2.4.62 (Debian) PHP/8.2.28-1~deb12u1' }, label: 'Distro build 8.2.28 (Caution – may be backported)' },
  '/patched':    { headers: { 'X-Powered-By': 'PHP/8.4.27' }, label: 'Patched 8.4.27 (Safe)' },
  '/patched83':  { headers: { 'X-Powered-By': 'PHP/8.3.36' }, label: 'Patched 8.3.36 (Safe)' },
  '/partial':    { headers: { 'X-Powered-By': 'PHP/8.3' }, label: 'Branch only 8.3 (Unverified)' },
  '/hidden.php': { headers: { 'Set-Cookie': 'PHPSESSID=demo123; Path=/; HttpOnly' }, label: 'PHP detected, version hidden (Unverified)' },
  '/none':       { headers: { 'Server': 'nginx' }, label: 'No PHP (neutral)' }
};

function page(title, body) {
  return `<!doctype html><meta charset="utf-8"><title>${title}</title>
<style>body{font:16px system-ui;max-width:720px;margin:60px auto;padding:0 20px;color:#111}a{display:block;padding:10px 0;border-bottom:1px solid #eee;text-decoration:none;color:#1d4ed8}code{background:#f1f5f9;padding:2px 6px;border-radius:4px}</style>
<h1>${title}</h1>${body}
<p style="margin-top:40px;color:#64748b">PHPLens demo server – these pages only <em>pretend</em> to be PHP by sending headers. Nothing here is real PHP.</p>`;
}

createServer((req, res) => {
  const route = ROUTES[req.url.split('?')[0]];
  if (route) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', ...route.headers });
    const hdrs = Object.entries(route.headers).map(([k, v]) => `<li><code>${k}: ${v}</code></li>`).join('');
    res.end(page(route.label, `<p>This response carried:</p><ul>${hdrs}</ul><p>Open the PHPLens toolbar icon to see the verdict.</p><p><a href="/">← all demo states</a></p>`));
    return;
  }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Server': 'nginx' });
  const links = Object.entries(ROUTES).map(([p, r]) => `<a href="${p}">${r.label} <small>→ ${p}</small></a>`).join('');
  res.end(page('PHPLens demo states', links));
}).listen(PORT, '127.0.0.1', () => {
  console.log(`PHPLens demo server: http://127.0.0.1:${PORT}/`);
});
