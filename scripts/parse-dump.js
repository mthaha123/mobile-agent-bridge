const fs = require('fs');
const xml = fs.readFileSync('D:/code/mobile-agent-bridge/window_dump.xml', 'utf8');
// Split by <node to find all nodes
const parts = xml.split('<node ');
parts.forEach((p, i) => {
  if (i === 0) return;
  const textMatch = p.match(/text="([^"]*)"/);
  const descMatch = p.match(/content-desc="([^"]*)"/);
  const boundsMatch = p.match(/bounds="([^"]*)"/);
  const clickable = p.match(/clickable="(true|false)"/);
  const text = textMatch ? textMatch[1] : '';
  const desc = descMatch ? descMatch[1] : '';
  const bounds = boundsMatch ? boundsMatch[1] : '';
  const click = clickable ? clickable[1] : '';
  if (text || desc) {
    console.log(`text="${text}" desc="${desc}" click=${click} bounds=${bounds}`);
  }
});
