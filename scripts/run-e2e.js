require('child_process').exec(
  'node scripts/e2e/run-layer.mjs --layer=l2 --mock',
  { cwd: 'D:\\code\\mobile-agent-bridge', windowsHide: true },
  () => {}
)
