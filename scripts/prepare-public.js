const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const source = path.join(root, 'client', 'dist');
const target = path.join(root, 'public');

function copyRecursive(from, to) {
  if (!fs.existsSync(from)) {
    throw new Error(`Missing build output: ${from}. Run "npm run build:client" first.`);
  }

  fs.mkdirSync(to, { recursive: true });

  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const srcPath = path.join(from, entry.name);
    const destPath = path.join(to, entry.name);

    if (entry.isDirectory()) {
      copyRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

if (fs.existsSync(target)) {
  fs.rmSync(target, { recursive: true, force: true });
}

copyRecursive(source, target);
console.log(`Copied client build to ${target}`);
