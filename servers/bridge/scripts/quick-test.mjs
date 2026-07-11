import { WebSocket } from 'ws';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { setTimeout as sleep } from 'timers/promises';
const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = 19985;
const BASE = `ws://localhost:${PORT}`;

function connect(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const t = setTimeout(() => { ws.close(); reject('ws timeout') }, 5000);
    ws.on('open', () => { clearTimeout(t); resolve(ws) });
    ws.on('error', reject);
  });
}

function send(ws, frame, timeout = 10000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject('response timeout'), timeout);
    const h = d => { let p; try { p = JSON.parse(d.toString()) } catch { return }; if (p.type === 'notify') return; clearTimeout(t); ws.removeListener('message', h); resolve(p) };
    ws.on('message', h);
    ws.send(JSON.stringify(frame));
  });
}

// Step 1: login (no token)
const ws1 = await connect(BASE);
const login = await send(ws1, { type:'req', id:'1', method:'auth.login', params:{ password:'test123' } });
console.log('LOGIN:', login.ok, login.payload?.token?.slice(0, 15));
const token = login.payload?.token;
ws1.close();

// Step 2: connect with token, setup, create session
const ws2 = await connect(`${BASE}?token=${encodeURIComponent(token)}`);
const setup = await send(ws2, { type:'req', id:'2', method:'project.switch', params:{ directory: resolve(__dirname,'..') } });
console.log('SETUP:', setup.ok && setup.payload?.directory?.slice(0,30));

// wait briefly for SSE
await sleep(2000);

const sess = await send(ws2, { type:'req', id:'3', method:'session.create', params:{ title:'http-test-' + Date.now() } });
console.log('SESSION:', JSON.stringify(sess).slice(0, 400));
ws2.close();

process.exit(sess?.ok ? 0 : 1);
