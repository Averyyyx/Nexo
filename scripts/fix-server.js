const fs = require('fs');
const path = require('path');

const serverPath = path.join(__dirname, '..', 'server.js');
const lines = fs.readFileSync(serverPath, 'utf8').split(/\r?\n/);
const roleRoutes = lines.slice(248, 328).join('\n');
let body = lines.slice(328).join('\n');

const insertAfter = 'function ensureAuthenticated(req, res, next) {';
const idx = body.indexOf(insertAfter);
if (idx === -1) throw new Error('ensureAuthenticated not found');
const endIdx = body.indexOf('}\n\nfunction normalizeHandle', idx);
if (endIdx === -1) throw new Error('normalizeHandle anchor not found');

const header = [
  "require('dotenv').config();",
  '',
  "if (!process.env.SESSION_SECRET) process.env.SESSION_SECRET = 'vencord-desktop-session';",
  "if (!process.env.JWT_SECRET) process.env.JWT_SECRET = 'vencord-desktop-jwt';",
  "if (!process.env.CLIENT_ORIGIN) process.env.CLIENT_ORIGIN = 'http://localhost:4000';",
  "if (!process.env.NODE_ENV) process.env.NODE_ENV = 'production';",
  '',
  ''
].join('\n');

body = header + body.slice(0, endIdx + 2) + '\n' + roleRoutes + '\n' + body.slice(endIdx + 2);
fs.writeFileSync(serverPath, body);
console.log('server.js fixed, lines:', body.split(/\r?\n/).length);
