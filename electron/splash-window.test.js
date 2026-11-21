const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('splash window is compact, frameless, and draggable without blocking its button', () => {
  const main = fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8');
  const html = fs.readFileSync(path.join(__dirname, 'splash.html'), 'utf8');
  const windowBlock = main.match(/function createSplashWindow\(\)[\s\S]*?function createWindow\(/)?.[0] || '';
  assert.match(windowBlock, /width:\s*480/);
  assert.match(windowBlock, /height:\s*570/);
  assert.match(windowBlock, /resizable:\s*false/);
  assert.match(windowBlock, /frame:\s*false/);
  assert.match(html, /-webkit-app-region:\s*drag/);
  assert.match(html, /button\s*\{[^}]*-webkit-app-region:\s*no-drag/s);
});
