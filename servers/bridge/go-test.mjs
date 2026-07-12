import { WebSocket } from 'ws';
const ws = new WebSocket('ws://localhost:19986');
let step = 0;
ws.on('open', () => {
  ws.send(JSON.stringify({type:'req',id:'1',method:'auth.login',params:{password:'test123'}}));
});
ws.on('message', data => {
  const m = JSON.parse(data.toString());
  if (m.type === 'notify') return;
  step++;
  console.log('STEP' + step + ':', JSON.stringify(m).slice(0,400));
  if (step === 1 && m.payload?.token) {
    ws.send(JSON.stringify({type:'req',id:'2',method:'project.switch',params:{directory:'D:\\code\\mobile-agent-bridge\\servers\\bridge'}}));
  } else if (step === 2 && m.ok) {
    setTimeout(() => {
      ws.send(JSON.stringify({type:'req',id:'3',method:'session.create',params:{title:'test-' + Date.now()}}));
    }, 2000);
  } else if (step === 3) {
    console.log('SESSION CREATE RESPONSE RECEIVED');
    console.log('OK:', m.ok);
    console.log('ERROR:', m.error);
    console.log('Payload keys:', Object.keys(m.payload || {}));
    ws.close();
    process.exit(m.ok ? 0 : 1);
  }
});
setTimeout(() => { console.log('FATAL TIMEOUT'); process.exit(1); }, 30000);
