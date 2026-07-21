const fs = require('fs');
const filename = process.argv[2] || 'dump_cur.xml';
const xml = fs.readFileSync(filename, 'utf8');

// Extract all nodes with text or content-desc
const nodes = [];
const regex = /<(node[^>]*?)\/>|<(node[^>]*?)>/g;
let match;
while ((match = regex.exec(xml)) !== null) {
  const nodeStr = match[1] || match[2];
  const textMatch = nodeStr.match(/text="([^"]*)"/);
  const descMatch = nodeStr.match(/content-desc="([^"]*)"/);
  const boundsMatch = nodeStr.match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/);
  const clickableMatch = nodeStr.match(/clickable="(true|false)"/);
  
  if (textMatch || descMatch) {
    const text = textMatch ? textMatch[1] : '';
    const desc = descMatch ? descMatch[1] : '';
    const bounds = boundsMatch ? `[${boundsMatch[1]},${boundsMatch[2]}]-[${boundsMatch[3]},${boundsMatch[4]}]` : '';
    const clickable = clickableMatch ? clickableMatch[1] : '';
    
    if (text || desc) {
      nodes.push({ text, desc, bounds, clickable });
    }
  }
}

// Print summary
console.log('=== Current Screen Elements ===');
nodes.forEach(n => {
  const label = n.text || n.desc;
  const click = n.clickable === 'true' ? ' [CLICKABLE]' : '';
  console.log(`  ${label}${click} @ ${n.bounds}`);
});