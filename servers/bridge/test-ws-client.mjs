import { WebSocket } from 'ws';
import { writeFileSync, appendFileSync } from 'fs';

const LOG = 'test-ws-client.log';
writeFileSync(LOG, 'start\n');

const ws = new WebSocket('ws://localhost:8080/ws');

ws.on('open', () => {
  appendFileSync(LOG, 'OPEN\n');
  const frame = { type: 'req', method: 'auth.login', params: { password: 'test123' }, id: '1' };
  const json = JSON.stringify(frame);
  appendFileSync(LOG, 'SEND:' + json + '\n');
  ws.send(json);
});

ws.on('message', (data) => {
  const s = data.toString();
  appendFileSync(LOG, 'RECV:' + s.slice(0, 500) + '\n');
  const parsed = JSON.parse(s);
  
  if (parsed.id === '1' && parsed.ok) {
    appendFileSync(LOG, 'AUTH OK, creating session...\n');
    ws.send(JSON.stringify({ type: 'req', method: 'session.create', params: { title: 'e2e-verify', model: 'opencode-go/mimo-v2.5' }, id: '2' }));
  }
  
  if (parsed.id === '2' && parsed.ok) {
    const sid = parsed.payload?.id;
    appendFileSync(LOG, 'SESSION:' + sid + '\n');
    ws.send(JSON.stringify({ type: 'req', method: 'message.send', params: { sessionId: sid, message: 'run the shell command: ls -la' }, id: '3' }));
  }
  
  if (parsed.id === '3') {
    appendFileSync(LOG, 'MSG_SENT id=3 ok=' + parsed.ok + '\n');
  }
  
  // Log notifications (streaming events)
  if (parsed.type === 'notify') {
    appendFileSync(LOG, 'NOTIFY:' + parsed.method + ' ' + JSON.stringify(parsed.payload).slice(0, 200) + '\n');
  }
});

ws.on('error', (e) => { appendFileSync(LOG, 'ERR:' + e.message + '\n'); });
ws.on('close', (c, r) => { appendFileSync(LOG, 'CLOSE:' + c + ' ' + r.toString() + '\n'); });

setTimeout(() => {
  appendFileSync(LOG, 'DONE\n');
  ws.close();
  process.exit(0);
}, 50000);
