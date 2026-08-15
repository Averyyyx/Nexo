const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const root = path.join(__dirname, '..');
const runtimeDir = path.join(root, 'build', 'runtime');
const target = path.join(runtimeDir, 'node.exe');

function resolveNodeBinary() {
  if (process.env.NODE_BINARY && fs.existsSync(process.env.NODE_BINARY)) {
    return process.env.NODE_BINARY;
  }

  try {
    const which = process.platform === 'win32' ? 'where node' : 'which node';
    const output = execSync(which, { encoding: 'utf8' }).trim().split(/\r?\n/)[0];
    if (output && fs.existsSync(output)) {
      return output;
    }
  } catch {
    // fall through
  }

  const candidates = [
    process.execPath,
    'C:\\Program Files\\nodejs\\node.exe',
    path.join(process.env.ProgramFiles || '', 'nodejs', 'node.exe'),
    path.join(process.env['ProgramFiles(x86)'] || '', 'nodejs', 'node.exe')
  ];

  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error('Could not find node.exe. Install Node.js or set NODE_BINARY.');
}

function ensureBetterSqlite3() {
  const moduleDir = path.join(root, 'node_modules', 'better-sqlite3');
  
  // Проверяем наличие бинарника в любом из возможных мест
  const possiblePaths = [
    path.join(moduleDir, 'build', 'Release', 'better_sqlite3.node'),
    path.join(moduleDir, 'build', 'Debug', 'better_sqlite3.node'),
    path.join(moduleDir, 'prebuilds', 'win32-x64-electron-39.2.3', 'better_sqlite3.node'),
    path.join(moduleDir, 'prebuilds', 'win32-x64-node-22.19.0', 'better_sqlite3.node')
  ];

  const foundBinary = possiblePaths.find(p => fs.existsSync(p));
  if (foundBinary) {
    console.log(`better-sqlite3 binary found at: ${foundBinary}`);
    return;
  }

  console.warn('better-sqlite3 binary not found. The module will try to load a prebuilt binary at runtime.');
  console.warn('If you encounter native module errors, run: npm rebuild better-sqlite3');
}

const source = resolveNodeBinary();
fs.mkdirSync(runtimeDir, { recursive: true });
fs.copyFileSync(source, target);
ensureBetterSqlite3();

console.log(`Prepared runtime node at ${target}`);
