const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const app = fs.readFileSync(path.join(__dirname, '..', 'client/src/App.tsx'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '..', 'client/src/styles.css'), 'utf8');

test('user dock contains exactly three actions and no legacy menu', () => {
  const actions = app.match(/className="dock-actions">([\s\S]*?)<\/div>/);
  assert.ok(actions, 'dock actions should exist');
  assert.equal((actions[1].match(/<button\b/g) || []).length, 3);
  assert.doesNotMatch(app, /dock-account-menu|dock-menu-/);
  assert.doesNotMatch(css, /dock-account-menu|dock-menu-/);
});

test('sidebar navigation scrolls independently from the fixed user dock', () => {
  assert.match(css, /\.nexo-sidebar\s*\{[^}]*height:\s*100%/s);
  assert.match(css, /\.nexo-sidebar\s*\{[^}]*overflow:\s*hidden/s);
  assert.match(css, /\.sidebar-scroll-area\s*\{[^}]*overflow-y:\s*auto/s);
  assert.match(css, /\.nexo-sidebar\s*>\s*\.sidebar-user-area\s*\{[^}]*margin-top:\s*auto/s);
  assert.match(css, /\.nexo-user-dock\s*\{[^}]*height:\s*52px/s);
});
