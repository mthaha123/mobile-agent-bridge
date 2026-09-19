/**
 * Verification: Navigate app to Chat, send message via bridge WS,
 * screenshot during streaming to verify scroll fixes.
 */
import { WebSocket } from 'ws';
import { writeFileSync, appendFileSync } from 'fs';
import { execSync } from 'child_process';

const LOG = 'v3.log';
const ADB = 'C:\\Users\\MT\\AppData\\Local\\Android\\Sdk\\platform-tools\\adb.exe';
const DIR = 'D:\\\\code\\\\mobile-agent-bridge';

function adb(cmd) {
  return execSync(`${ADB} ${cmd}`, { encoding: 'utf-8', timeout: 8000 }).trim();
}

function tap(x, y) {
  adb(`shell input tap ${x} ${y}`);
}

function screenshot(name) {
  adb(`shell screencap -p /sdcard/${name}.png`);
  adb(`pull /sdcard/${name}.png ${DIR}/logs/build/${name}.png`);
  adb(`shell rm /sdcard/${name}.png`);
  appendFileSync(LOG, `📸 ${name}\n`);
}

writeFileSync(LOG, '=== verify start ===\n');

// Step 1: Navigate to Chat tab (tap bottom-left "Chat" icon)
appendFileSync(LOG, 'Step 1: Navigate to Chat tab\n');
tap(54, 1262);  // Chat tab coordinates
execSync('timeout /t 2 /nobreak >nul', { shell: true });  // wait 2s (use short wait)

// Step 2: Screenshot to see current state
screenshot('v3-chat-state');

// Step 3: Connect to bridge, list sessions, create new one
appendFileSync(LOG, 'Step 2: Connect to bridge\n');
const ws = new WebSocket('ws://localhost:8080/ws');

let currentSessionId = null;

ws.on('open', () => {
  appendFileSync(LOG, 'WS OPEN\n');
  ws.send(JSON.stringify({ type: 'req', method: 'auth.login', params: { password: 'test123' }, id: '1' }));
});

ws.on('message', (data) => {
  const s = data.toString();
  const parsed = JSON.parse(s);
  
  if (parsed.id === '1' && parsed.ok) {
    // List sessions to find what app is showing
    ws.send(JSON.stringify({ type: 'req', method: 'session.list', params: {}, id: 'list' }));
  }
  
  if (parsed.id === 'list' && parsed.ok) {
    const sessions = parsed.payload || [];
    appendFileSync(LOG, `Found ${sessions.length} sessions\n`);
    for (const s of sessions) {
      appendFileSync(LOG, `  ${s.id}: ${s.title}\n`);
    }
    
    // Use the first session (most recent) or create new
    if (sessions.length > 0) {
      currentSessionId = sessions[0].id;
      appendFileSync(LOG, `Using session: ${currentSessionId}\n`);
    } else {
      // Create new session
      ws.send(JSON.stringify({
        type: 'req', method: 'session.create',
        params: { title: 'scroll-verify', model: 'opencode-go/mimo-v2.5' },
        id: 'create'
      }));
      return;
    }
    
    // Send message to trigger tool calls
    setTimeout(() => {
      ws.send(JSON.stringify({
        type: 'req', method: 'message.send',
        params: {
          sessionId: currentSessionId,
          message: 'write a python hello world program, show the code in a code block, then run it'
        },
        id: 'send'
      }));
      appendFileSync(LOG, 'MSG SENT\n');
    }, 1000);
  }
  
  if (parsed.id === 'create' && parsed.ok) {
    currentSessionId = parsed.payload?.id;
    appendFileSync(LOG, 'Created session: ' + currentSessionId + '\n');
    ws.send(JSON.stringify({
      type: 'req', method: 'message.send',
      params: {
        sessionId: currentSessionId,
        message: 'write a python hello world program, show the code in a code block, then run it'
      },
      id: 'send'
    }));
    appendFileSync(LOG, 'MSG SENT\n');
  }
  
  if (parsed.type === 'notify') {
    appendFileSync(LOG, 'NOTIFY: ' + parsed.method + '\n');
  }
});

ws.on('error', (e) => appendFileSync(LOG, 'ERR: ' + e.message + '\n'));

// Take screenshots at intervals
setTimeout(() => screenshot('v3-t3'), 3000);
setTimeout(() => screenshot('v3-t6'), 6000);
setTimeout(() => screenshot('v3-t10'), 10000);
setTimeout(() => screenshot('v3-t15'), 15000);
setTimeout(() => {
  screenshot('v3-final');
  appendFileSync(LOG, 'DONE\n');
  ws.close();
  process.exit(0);
}, 18000);
