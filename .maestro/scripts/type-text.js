const { execSync } = require('child_process');
const text = env.TEXT;
// Use adb input text - spaces need to be escaped
const escaped = text.replace(/ /g, '%s');
execSync(`adb shell input text "${escaped}"`, { stdio: 'inherit' });
