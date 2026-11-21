require('dotenv').config();

if (!process.env.SESSION_SECRET) {
  console.warn('WARNING: Using default SESSION_SECRET. Set SESSION_SECRET in production!');
  process.env.SESSION_SECRET = 'nexo-desktop-session-secret-change-in-production';
}
if (!process.env.JWT_SECRET) {
  console.warn('WARNING: Using default JWT_SECRET. Set JWT_SECRET in production!');
  process.env.JWT_SECRET = 'nexo-desktop-jwt-secret-change-in-production';
}
if (!process.env.CLIENT_ORIGIN) process.env.CLIENT_ORIGIN = 'http://localhost:4000';
if (!process.env.NODE_ENV) process.env.NODE_ENV = 'production';

const isDesktop = process.env.ELECTRON_DESKTOP === '1';

const path = require('path');
const fs = require('fs');
const fsp = require('fs/promises');
const http = require('http');
const express = require('express');
const session = require('express-session');
const RedisStore = require('connect-redis').default;
const { createClient: createRedisClient } = require('redis');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const csrf = require('csurf');
const mongoSanitize = require('express-mongo-sanitize');
const hpp = require('hpp');
const bcrypt = require('bcryptjs');
const passport = require('passport');
const LocalStrategy = require('passport-local').Strategy;
const GitHubStrategy = require('passport-github2').Strategy;
const Database = require('better-sqlite3');
const sharp = require('sharp');
const speakeasy = require('speakeasy');
const QRCode = require('qrcode');
const zxcvbn = require('zxcvbn');
const { fileTypeFromFile } = require('file-type');
const NodeClam = require('clamscan');
const multer = require('multer');
const { Server } = require('socket.io');
const { randomUUID, randomBytes } = require('crypto');
const { isValidEmail } = require('./electron/email-validation');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 4000;

// Каталог данных. Сервер работает как отдельный процесс (Node/Electron-as-Node),
// поэтому модуль 'electron' здесь недоступен: путь всегда передаёт main.js через DATA_DIR.
const dataDir = process.env.DATA_DIR || path.join(__dirname, 'data');

// public лежит рядом с server.js (и в dev, и в упакованном приложении)
const publicDir = path.join(__dirname, 'public');

// Логируем путь к publicDir
console.log('Public directory path:', publicDir);
console.log('Public directory exists:', fs.existsSync(publicDir));

if (!fs.existsSync(publicDir)) {
  console.error('ERROR: Public directory does not exist:', publicDir);
  console.error('Current working directory:', process.cwd());
  console.error('__dirname:', __dirname);
}
const uploadsDir = path.join(dataDir, 'uploads');
const tempUploadsDir = path.join(dataDir, 'tmp');
const avatarsDir = path.join(dataDir, 'avatars');
const ALLOWED_MIME_TYPES = new Set(
  (process.env.ALLOWED_MIME_TYPES ||
    'image/png,image/jpeg,image/webp,image/gif,video/mp4,application/pdf')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
);
const ALLOWED_EXTENSIONS = new Set(
  (process.env.ALLOWED_EXTENSIONS || '.png,.jpg,.jpeg,.webp,.gif,.mp4,.pdf')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean)
);
const PASSWORD_MIN_SCORE = Number(process.env.PASSWORD_MIN_SCORE || 3);
const REQUIRE_HTTPS = process.env.REQUIRE_HTTPS === 'true';
const isProduction = process.env.NODE_ENV === 'production';
const PREMIUM_BRAND = process.env.PREMIUM_BRAND || 'Nexo Pulse';
const PREMIUM_BALANCE_TOKEN = process.env.PREMIUM_BALANCE_TOKEN || '';

const useMemorySession = process.env.USE_MEMORY_SESSION === 'true' || isDesktop;
const useSQLiteSession = isDesktop || useMemorySession;
let redisClient = null;

if (!useSQLiteSession) {
  redisClient = createRedisClient({
    url: process.env.REDIS_URL || 'redis://127.0.0.1:6379'
  });
  redisClient.on('error', (err) => {
    console.error('Redis error', err);
  });
  redisClient.connect().catch((err) => {
    console.error('Redis connection failed', err);
  });
}

let clamScannerPromise = null;

async function initClamScanner() {
  if (!clamScannerPromise) {
    const host = process.env.CLAMAV_HOST || '127.0.0.1';
    const port = Number(process.env.CLAMAV_PORT || 3310);
    clamScannerPromise = new NodeClam()
      .init({
        removeInfected: false,
        quarantineInfected: false,
        scanLog: null,
        clamdscan: {
          host,
          port,
          socket: process.env.CLAMAV_SOCKET || false,
          timeout: 60000,
          localFallback: true
        },
        preference: 'clamdscan'
      })
      .catch((error) => {
        console.warn('ClamAV initialization failed:', error.message);
        return null;
      });
  }
  return clamScannerPromise;
}

async function scanUploadedFile(filePath) {
  const scanner = await initClamScanner();
  if (!scanner) {
    return true;
  }
  try {
    const { isInfected } = await scanner.isInfected(filePath);
    return !isInfected;
  } catch (error) {
    console.warn('ClamAV scan error:', error.message);
    return true;
  }
}

async function removeFileSafe(filePath) {
  if (!filePath) return;
  try {
    await fsp.unlink(filePath);
  } catch {
    // ignore
  }
}

async function processAttachment(file, buildUrl) {
  const detected = await fileTypeFromFile(file.path).catch(() => null);
  const mime = detected?.mime || file.mimetype;
  const ext =
    (detected?.ext ? `.${detected.ext}` : path.extname(file.originalname))?.toLowerCase() || '';

  if (!ALLOWED_MIME_TYPES.has(mime) || (ext && !ALLOWED_EXTENSIONS.has(ext))) {
    await removeFileSafe(file.path);
    const error = new Error('Unsupported or disallowed file type.');
    error.statusCode = 415;
    throw error;
  }

  const clean = await scanUploadedFile(file.path);
  if (!clean) {
    await removeFileSafe(file.path);
    const error = new Error('File failed security scan.');
    error.statusCode = 400;
    throw error;
  }

  const attachmentId = randomUUID();
  const storageName = `${attachmentId}${ext}`;
  const finalPath = path.join(uploadsDir, storageName);
  await fsp.rename(file.path, finalPath);

  const publicMeta = {
    id: attachmentId,
    name: file.originalname,
    mime,
    size: file.size,
    url: buildUrl(attachmentId)
  };

  return {
    public: publicMeta,
    storagePath: storageName
  };
}

function processDmAttachment(file, conversationId) {
  return processAttachment(file, (attachmentId) => `/api/files/${conversationId}/${attachmentId}`);
}

function processServerAttachment(file, serverId, channelId) {
  return processAttachment(
    file,
    (attachmentId) => `/api/servers/${serverId}/channels/${channelId}/files/${attachmentId}`
  );
}

if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

if (!fs.existsSync(publicDir)) {
  fs.mkdirSync(publicDir, { recursive: true });
}

if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

if (!fs.existsSync(tempUploadsDir)) {
  fs.mkdirSync(tempUploadsDir, { recursive: true });
}
if (!fs.existsSync(avatarsDir)) {
  fs.mkdirSync(avatarsDir, { recursive: true });
}

const db = new Database(process.env.DB_PATH || path.join(dataDir, 'nexo.db'));
db.pragma('journal_mode = WAL');

db.prepare(`
  CREATE TABLE IF NOT EXISTS http_sessions (
    sid TEXT PRIMARY KEY,
    sess TEXT NOT NULL,
    expires_at INTEGER NOT NULL
  )
`).run();

if (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'app_sessions'").get()) {
  db.prepare('INSERT OR IGNORE INTO http_sessions (sid, sess, expires_at) SELECT sid, sess, expires_at FROM app_sessions').run();
}

class SQLiteSessionStore extends session.Store {
  constructor(database) {
    super();
    this.readSession = database.prepare('SELECT sess, expires_at FROM http_sessions WHERE sid = ?');
    this.writeSession = database.prepare(`
      INSERT INTO http_sessions (sid, sess, expires_at) VALUES (?, ?, ?)
      ON CONFLICT(sid) DO UPDATE SET sess = excluded.sess, expires_at = excluded.expires_at
    `);
    this.touchSession = database.prepare('UPDATE http_sessions SET expires_at = ? WHERE sid = ?');
    this.deleteSession = database.prepare('DELETE FROM http_sessions WHERE sid = ?');
    this.deleteExpired = database.prepare('DELETE FROM http_sessions WHERE expires_at <= ?');
    this.cleanupTimer = setInterval(() => {
      try { this.deleteExpired.run(Date.now()); } catch (error) {
        console.warn('Session cleanup failed:', error.message);
      }
    }, 60 * 60 * 1000);
    this.cleanupTimer.unref?.();
  }

  get(sid, callback) {
    try {
      const row = this.readSession.get(sid);
      if (!row) return callback(null, null);
      if (row.expires_at <= Date.now()) {
        this.deleteSession.run(sid);
        return callback(null, null);
      }
      return callback(null, JSON.parse(row.sess));
    } catch (error) { return callback(error); }
  }

  set(sid, sess, callback) {
    try {
      const expiry = sess.cookie?.expires ? new Date(sess.cookie.expires).getTime() : Date.now() + 30 * 24 * 60 * 60 * 1000;
      this.writeSession.run(sid, JSON.stringify(sess), Number.isFinite(expiry) ? expiry : Date.now() + 30 * 24 * 60 * 60 * 1000);
      callback?.(null);
    } catch (error) { callback?.(error); }
  }

  touch(sid, sess, callback) {
    try {
      const expiry = sess.cookie?.expires ? new Date(sess.cookie.expires).getTime() : Date.now() + 30 * 24 * 60 * 60 * 1000;
      this.touchSession.run(Number.isFinite(expiry) ? expiry : Date.now() + 30 * 24 * 60 * 60 * 1000, sid);
      callback?.(null);
    } catch (error) { callback?.(error); }
  }

  destroy(sid, callback) {
    try { this.deleteSession.run(sid); callback?.(null); }
    catch (error) { callback?.(error); }
  }
}

db.prepare(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    username TEXT NOT NULL,
    password_hash TEXT,
    avatar_url TEXT DEFAULT '',
    email_verified INTEGER DEFAULT 0,
    twofa_secret TEXT,
    twofa_enabled INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`).run();

const ensureUserColumn = (name, definition) => {
  const columns = db.prepare('PRAGMA table_info(users)').all();
  const exists = columns.some((column) => column.name === name);
  if (!exists) {
    db.prepare(`ALTER TABLE users ADD COLUMN ${definition}`).run();
  }
};

const ensureChannelColumn = (name, definition) => {
  const columns = db.prepare('PRAGMA table_info(channels)').all();
  const exists = columns.some((column) => column.name === name);
  if (!exists) {
    db.prepare(`ALTER TABLE channels ADD COLUMN ${definition}`).run();
  }
};

ensureUserColumn('display_name', `display_name TEXT DEFAULT ''`);
ensureUserColumn('discriminator', `discriminator TEXT DEFAULT '0001'`);
ensureUserColumn('profile_complete', `profile_complete INTEGER DEFAULT 0`);
ensureUserColumn('bio', `bio TEXT DEFAULT ''`);
ensureUserColumn('avatar_color', `avatar_color TEXT DEFAULT '#D97757'`);
const hadAvatarPresetColumn = db.prepare('PRAGMA table_info(users)').all().some((column) => column.name === 'avatar_preset');
ensureUserColumn('avatar_preset', 'avatar_preset INTEGER');
if (!hadAvatarPresetColumn) {
  db.prepare('UPDATE users SET avatar_preset = ((id * 7 + 3) % 12)').run();
}
db.prepare(`
  CREATE TRIGGER IF NOT EXISTS users_assign_avatar_preset
  AFTER INSERT ON users
  WHEN NEW.avatar_preset IS NULL
  BEGIN
    UPDATE users SET avatar_preset = ((NEW.id * 7 + 3) % 12) WHERE id = NEW.id;
  END
`).run();
ensureUserColumn('username_changed_at', 'username_changed_at DATETIME');
ensureUserColumn('display_name_changed_at', 'display_name_changed_at DATETIME');
ensureUserColumn('status', "status TEXT DEFAULT 'online'");
ensureUserColumn('custom_status', "custom_status TEXT DEFAULT ''");
db.prepare("UPDATE users SET avatar_color = '#D97757' WHERE avatar_color IS NULL OR avatar_color = ''").run();
ensureUserColumn('email_verified', `email_verified INTEGER DEFAULT 0`);
ensureUserColumn('twofa_secret', `twofa_secret TEXT`);
ensureUserColumn('twofa_enabled', `twofa_enabled INTEGER DEFAULT 0`);

db.prepare(`
  CREATE TABLE IF NOT EXISTS oauth_accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    provider TEXT NOT NULL,
    provider_user_id TEXT NOT NULL,
    access_token TEXT,
    refresh_token TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(provider, provider_user_id),
    FOREIGN KEY(user_id) REFERENCES users(id)
  )
`).run();

db.prepare(`
  CREATE TABLE IF NOT EXISTS conversations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL DEFAULT 'dm',
    title TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`).run();

db.prepare(`
  CREATE TABLE IF NOT EXISTS conversation_participants (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    role TEXT DEFAULT 'member',
    joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_read_message_id INTEGER,
    UNIQUE(conversation_id, user_id),
    FOREIGN KEY(conversation_id) REFERENCES conversations(id),
    FOREIGN KEY(user_id) REFERENCES users(id)
  )
`).run();

db.prepare(`
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id INTEGER NOT NULL,
    author_id INTEGER NOT NULL,
    content TEXT,
    attachment TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(conversation_id) REFERENCES conversations(id),
    FOREIGN KEY(author_id) REFERENCES users(id)
  )
`).run();

db.prepare(`
  CREATE TABLE IF NOT EXISTS message_deliveries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id INTEGER NOT NULL,
    message_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    delivered_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(message_id, user_id),
    FOREIGN KEY(conversation_id) REFERENCES conversations(id),
    FOREIGN KEY(user_id) REFERENCES users(id)
  )
`).run();

if (!db.prepare('PRAGMA table_info(messages)').all().some((column) => column.name === 'edited_at')) {
  db.prepare('ALTER TABLE messages ADD COLUMN edited_at DATETIME').run();
}
if (!db.prepare('PRAGMA table_info(messages)').all().some((column) => column.name === 'reply_to_message_id')) {
  db.prepare('ALTER TABLE messages ADD COLUMN reply_to_message_id INTEGER').run();
}

db.prepare(`
  CREATE TABLE IF NOT EXISTS attachments (
    id TEXT PRIMARY KEY,
    message_id INTEGER NOT NULL,
    conversation_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    mime TEXT NOT NULL,
    size INTEGER NOT NULL,
    path TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(message_id) REFERENCES messages(id),
    FOREIGN KEY(conversation_id) REFERENCES conversations(id)
  )
`).run();

db.prepare(`
  CREATE TABLE IF NOT EXISTS servers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    owner_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    icon TEXT DEFAULT '',
    description TEXT DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(owner_id) REFERENCES users(id)
  )
`).run();

db.prepare(`
  CREATE TABLE IF NOT EXISTS server_members (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    server_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    role TEXT NOT NULL DEFAULT 'member',
    nickname TEXT DEFAULT '',
    joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(server_id, user_id),
    FOREIGN KEY(server_id) REFERENCES servers(id),
    FOREIGN KEY(user_id) REFERENCES users(id)
  )
`).run();

db.prepare(`
  CREATE TABLE IF NOT EXISTS channels (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    server_id INTEGER NOT NULL,
    type TEXT NOT NULL DEFAULT 'text',
    name TEXT NOT NULL,
    topic TEXT DEFAULT '',
    position INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(server_id) REFERENCES servers(id)
  )
`).run();

ensureChannelColumn('slow_mode_seconds', 'slow_mode_seconds INTEGER DEFAULT 0');
ensureChannelColumn('is_nsfw', 'is_nsfw INTEGER DEFAULT 0');
ensureChannelColumn('bitrate', 'bitrate INTEGER DEFAULT 64000');
ensureChannelColumn('user_limit', 'user_limit INTEGER DEFAULT 8');
db.prepare('UPDATE channels SET user_limit = 8 WHERE user_limit IS NULL OR user_limit = 0').run();
ensureChannelColumn('soundscape', "soundscape TEXT DEFAULT ''");

db.prepare(`
  CREATE TABLE IF NOT EXISTS server_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    server_id INTEGER NOT NULL,
    channel_id INTEGER NOT NULL,
    author_id INTEGER NOT NULL,
    content TEXT,
    attachment TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(server_id) REFERENCES servers(id),
    FOREIGN KEY(channel_id) REFERENCES channels(id),
    FOREIGN KEY(author_id) REFERENCES users(id)
  )
`).run();

db.prepare(`
  CREATE TABLE IF NOT EXISTS message_reactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    scope TEXT NOT NULL CHECK (scope IN ('dm', 'channel')),
    message_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    emoji TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(scope, message_id, user_id, emoji),
    FOREIGN KEY(user_id) REFERENCES users(id)
  )
`).run();

db.prepare(`
  CREATE TABLE IF NOT EXISTS message_pins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    scope TEXT NOT NULL CHECK (scope IN ('dm', 'channel')),
    message_id INTEGER NOT NULL,
    conversation_id INTEGER,
    server_id INTEGER,
    channel_id INTEGER,
    pinned_by INTEGER NOT NULL,
    pinned_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(scope, message_id),
    FOREIGN KEY(pinned_by) REFERENCES users(id)
  )
`).run();

db.prepare(`
  CREATE TABLE IF NOT EXISTS channel_read_states (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    channel_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    last_read_message_id INTEGER NOT NULL DEFAULT 0,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(channel_id, user_id),
    FOREIGN KEY(channel_id) REFERENCES channels(id),
    FOREIGN KEY(user_id) REFERENCES users(id)
  )
`).run();

if (!db.prepare('PRAGMA table_info(server_messages)').all().some((column) => column.name === 'edited_at')) {
  db.prepare('ALTER TABLE server_messages ADD COLUMN edited_at DATETIME').run();
}
if (!db.prepare('PRAGMA table_info(server_messages)').all().some((column) => column.name === 'reply_to_message_id')) {
  db.prepare('ALTER TABLE server_messages ADD COLUMN reply_to_message_id INTEGER').run();
}

db.prepare(`
  CREATE TABLE IF NOT EXISTS server_attachments (
    id TEXT PRIMARY KEY,
    server_message_id INTEGER NOT NULL,
    server_id INTEGER NOT NULL,
    channel_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    mime TEXT NOT NULL,
    size INTEGER NOT NULL,
    path TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(server_message_id) REFERENCES server_messages(id),
    FOREIGN KEY(server_id) REFERENCES servers(id),
    FOREIGN KEY(channel_id) REFERENCES channels(id)
  )
`).run();

db.prepare(`
  CREATE TABLE IF NOT EXISTS friendships (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    requester_id INTEGER NOT NULL,
    addressee_id INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(requester_id, addressee_id),
    FOREIGN KEY(requester_id) REFERENCES users(id),
    FOREIGN KEY(addressee_id) REFERENCES users(id)
  )
`).run();

db.prepare(`
  CREATE TABLE IF NOT EXISTS user_settings (
    user_id INTEGER PRIMARY KEY,
    theme TEXT DEFAULT 'system',
    accent TEXT DEFAULT 'terracotta',
    background_url TEXT DEFAULT '',
    reduce_motion INTEGER DEFAULT 0,
    badges TEXT DEFAULT '[]',
    FOREIGN KEY(user_id) REFERENCES users(id)
  )
`).run();

// Миграция старых цветных тем (nebula/midnight/lilac/onyx/solstice) и акцентов:
// прежний интерфейс был тёмным, поэтому всё сводим к 'dark'; новые значения — light/dark/system.
db.prepare(`
  UPDATE user_settings
  SET theme = 'dark'
  WHERE theme NOT IN ('light', 'dark', 'system')
`).run();
db.prepare(`
  UPDATE user_settings
  SET accent = 'terracotta'
  WHERE accent != 'terracotta'
`).run();

db.prepare(`
  CREATE TABLE IF NOT EXISTS server_settings (
    server_id INTEGER PRIMARY KEY,
    default_notifications TEXT DEFAULT 'all',
    verification_level TEXT DEFAULT 'low',
    system_channel_id INTEGER,
    banner_url TEXT DEFAULT '',
    premium_theme TEXT DEFAULT '',
    FOREIGN KEY(server_id) REFERENCES servers(id)
  )
`).run();

db.prepare(`
  CREATE TABLE IF NOT EXISTS premium_plans (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slug TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    description TEXT DEFAULT '',
    price_cents INTEGER NOT NULL,
    currency TEXT NOT NULL DEFAULT 'USD',
    perks TEXT DEFAULT '[]',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`).run();

db.prepare(`
  CREATE TABLE IF NOT EXISTS premium_subscriptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    plan_id INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    renews_at DATETIME,
    metadata TEXT,
    FOREIGN KEY(user_id) REFERENCES users(id),
    FOREIGN KEY(plan_id) REFERENCES premium_plans(id)
  )
`).run();

db.prepare(`
  CREATE TABLE IF NOT EXISTS premium_transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    plan_id INTEGER NOT NULL,
    amount_cents INTEGER NOT NULL,
    currency TEXT NOT NULL DEFAULT 'USD',
    status TEXT NOT NULL DEFAULT 'pending',
    payment_intent TEXT,
    client_secret TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id),
    FOREIGN KEY(plan_id) REFERENCES premium_plans(id)
  )
`).run();

db.prepare(`
  CREATE TABLE IF NOT EXISTS server_roles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    server_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    color TEXT DEFAULT '#ffffff',
    position INTEGER DEFAULT 0,
    permissions INTEGER NOT NULL DEFAULT 0,
    is_default INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(server_id) REFERENCES servers(id)
  )
`).run();

db.prepare(`
  CREATE TABLE IF NOT EXISTS server_member_roles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    server_id INTEGER NOT NULL,
    role_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    UNIQUE(server_id, role_id, user_id),
    FOREIGN KEY(server_id) REFERENCES servers(id),
    FOREIGN KEY(role_id) REFERENCES server_roles(id),
    FOREIGN KEY(user_id) REFERENCES users(id)
  )
`).run();

db.prepare(`
  CREATE TABLE IF NOT EXISTS channel_permission_overrides (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    channel_id INTEGER NOT NULL,
    target_type TEXT NOT NULL CHECK(target_type IN ('role', 'member')),
    target_id INTEGER NOT NULL,
    allow INTEGER NOT NULL DEFAULT 0,
    deny INTEGER NOT NULL DEFAULT 0,
    UNIQUE(channel_id, target_type, target_id),
    FOREIGN KEY(channel_id) REFERENCES channels(id)
  )
`).run();

db.prepare(`
  CREATE TABLE IF NOT EXISTS voice_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    server_id INTEGER NOT NULL,
    channel_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    muted INTEGER DEFAULT 0,
    deafened INTEGER DEFAULT 0,
    joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(channel_id, user_id),
    FOREIGN KEY(server_id) REFERENCES servers(id),
    FOREIGN KEY(channel_id) REFERENCES channels(id),
    FOREIGN KEY(user_id) REFERENCES users(id)
  )
`).run();

// Voice sessions are ephemeral: never restore ghost participants after a process restart.
db.prepare('DELETE FROM voice_sessions').run();

const selectUserByEmail = db.prepare('SELECT * FROM users WHERE email = ?');
const selectUserById = db.prepare('SELECT * FROM users WHERE id = ?');
const insertUser = db.prepare('INSERT INTO users (email, username, password_hash, avatar_url, email_verified, twofa_enabled, twofa_secret) VALUES (?, ?, ?, ?, ?, ?, ?)');
const selectUserByUsername = db.prepare('SELECT * FROM users WHERE username = ?');
const updateTwoFactor = db.prepare('UPDATE users SET twofa_secret = ?, twofa_enabled = ? WHERE id = ?');
const updatePasswordHash = db.prepare('UPDATE users SET password_hash = ? WHERE id = ?');
const markProfile = db.prepare(`
  UPDATE users
  SET display_name = ?, username = ?, discriminator = ?, bio = ?, avatar_color = ?,
      avatar_url = CASE WHEN avatar_preset != ? THEN '' ELSE avatar_url END,
      avatar_preset = ?, profile_complete = 1,
      display_name_changed_at = CASE WHEN display_name != ? THEN CURRENT_TIMESTAMP ELSE display_name_changed_at END,
      username_changed_at = CASE WHEN username != ? THEN CURRENT_TIMESTAMP ELSE username_changed_at END
  WHERE id = ?
`);
const selectOAuthAccount = db.prepare('SELECT * FROM oauth_accounts WHERE provider = ? AND provider_user_id = ?');
const insertOAuthAccount = db.prepare(`
  INSERT INTO oauth_accounts (user_id, provider, provider_user_id, access_token, refresh_token)
  VALUES (?, ?, ?, ?, ?)
`);
const insertConversation = db.prepare('INSERT INTO conversations (type, title) VALUES (?, ?)');
const updateConversationTimestamp = db.prepare('UPDATE conversations SET updated_at = CURRENT_TIMESTAMP WHERE id = ?');
const selectConversationById = db.prepare('SELECT * FROM conversations WHERE id = ?');
const selectConversationBetween = db.prepare(`
  SELECT c.*
  FROM conversations c
  JOIN conversation_participants cp1 ON cp1.conversation_id = c.id AND cp1.user_id = ?
  JOIN conversation_participants cp2 ON cp2.conversation_id = c.id AND cp2.user_id = ?
  WHERE c.type = 'dm'
`);
const insertParticipant = db.prepare('INSERT INTO conversation_participants (conversation_id, user_id, role) VALUES (?, ?, ?)');
const selectParticipants = db.prepare(`
  SELECT u.*, cp.last_read_message_id
  FROM conversation_participants cp
  JOIN users u ON u.id = cp.user_id
  WHERE cp.conversation_id = ?
`);
const selectParticipant = db.prepare('SELECT * FROM conversation_participants WHERE conversation_id = ? AND user_id = ?');
const updateConversationRead = db.prepare(`
  UPDATE conversation_participants
  SET last_read_message_id = MAX(COALESCE(last_read_message_id, 0), ?)
  WHERE conversation_id = ? AND user_id = ?
`);
const listConversationsForUser = db.prepare(`
  SELECT c.*, MAX(m.created_at) AS last_activity
  FROM conversations c
  JOIN conversation_participants cp ON cp.conversation_id = c.id
  LEFT JOIN messages m ON m.conversation_id = c.id
  WHERE cp.user_id = ?
  GROUP BY c.id
  ORDER BY datetime(COALESCE(last_activity, c.updated_at)) DESC
`);
const insertMessageDelivery = db.prepare('INSERT OR IGNORE INTO message_deliveries (conversation_id, message_id, user_id) VALUES (?, ?, ?)');
const selectMessageDeliverySummary = db.prepare(`
  SELECT
    (SELECT COUNT(*) FROM message_deliveries WHERE conversation_id = ? AND message_id = ?) AS delivered_count,
    (SELECT COUNT(*) FROM conversation_participants WHERE conversation_id = ? AND user_id != ?) AS recipient_count
`);
const insertMessage = db.prepare('INSERT INTO messages (conversation_id, author_id, content, attachment, reply_to_message_id) VALUES (?, ?, ?, ?, ?)');
const selectMessageById = db.prepare('SELECT * FROM messages WHERE id = ?');
const selectMessageWithAuthor = db.prepare(`
  SELECT m.*, u.username, u.display_name, u.avatar_url, u.avatar_color, u.avatar_preset
  FROM messages m
  JOIN users u ON u.id = m.author_id
  WHERE m.id = ?
`);
const selectMessagePin = db.prepare('SELECT pinned_at, pinned_by FROM message_pins WHERE scope = ? AND message_id = ?');
const insertMessagePin = db.prepare('INSERT OR IGNORE INTO message_pins (scope, message_id, conversation_id, server_id, channel_id, pinned_by) VALUES (?, ?, ?, ?, ?, ?)');
const deleteMessagePin = db.prepare('DELETE FROM message_pins WHERE scope = ? AND message_id = ?');
const listDmPins = db.prepare("SELECT message_id FROM message_pins WHERE scope = 'dm' AND conversation_id = ? ORDER BY datetime(pinned_at) DESC");
const listChannelPins = db.prepare("SELECT message_id FROM message_pins WHERE scope = 'channel' AND channel_id = ? ORDER BY datetime(pinned_at) DESC");

const listMessageReactions = db.prepare(`
  SELECT emoji, COUNT(*) AS count, GROUP_CONCAT(user_id) AS user_ids
  FROM message_reactions WHERE scope = ? AND message_id = ?
  GROUP BY emoji ORDER BY MIN(id) ASC
`);
const insertMessageReaction = db.prepare('INSERT OR IGNORE INTO message_reactions (scope, message_id, user_id, emoji) VALUES (?, ?, ?, ?)');
const deleteMessageReaction = db.prepare('DELETE FROM message_reactions WHERE scope = ? AND message_id = ? AND user_id = ? AND emoji = ?');

const listMessages = db.prepare(`
  SELECT m.*, u.username, u.display_name, u.avatar_url, u.avatar_color, u.avatar_preset
  FROM messages m
  JOIN users u ON u.id = m.author_id
  WHERE m.conversation_id = ?
  ORDER BY m.id DESC
  LIMIT ?
  OFFSET ?
`);
const selectLastMessageForConversation = db.prepare(`
  SELECT m.*, u.username, u.display_name, u.avatar_url, u.avatar_color, u.avatar_preset
  FROM messages m JOIN users u ON u.id = m.author_id
  WHERE m.conversation_id = ? ORDER BY m.id DESC LIMIT 1
`);
const listFriendships = db.prepare('SELECT * FROM friendships WHERE requester_id = ? OR addressee_id = ?');
const insertAttachmentRecord = db.prepare(`
  INSERT INTO attachments (id, message_id, conversation_id, name, mime, size, path)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`);
const selectAttachmentById = db.prepare('SELECT * FROM attachments WHERE id = ?');
const selectFriendshipBetween = db.prepare(`
  SELECT * FROM friendships
  WHERE (requester_id = ? AND addressee_id = ?) OR (requester_id = ? AND addressee_id = ?)
`);
const selectFriendshipById = db.prepare('SELECT * FROM friendships WHERE id = ?');
const insertFriendRequest = db.prepare('INSERT INTO friendships (requester_id, addressee_id, status) VALUES (?, ?, ?)');
const updateFriendStatus = db.prepare('UPDATE friendships SET status = ? WHERE id = ?');
const deleteFriendship = db.prepare('DELETE FROM friendships WHERE id = ?');
const insertServer = db.prepare('INSERT INTO servers (owner_id, name, icon, description) VALUES (?, ?, ?, ?)');
const selectServerById = db.prepare('SELECT * FROM servers WHERE id = ?');
const listServersForUser = db.prepare(`
  SELECT s.*, sm.role
  FROM servers s
  JOIN server_members sm ON sm.server_id = s.id
  WHERE sm.user_id = ?
  ORDER BY datetime(s.created_at) DESC
`);
const insertServerMember = db.prepare('INSERT INTO server_members (server_id, user_id, role, nickname) VALUES (?, ?, ?, ?)');
const selectServerMember = db.prepare('SELECT * FROM server_members WHERE server_id = ? AND user_id = ?');
const listServerMembers = db.prepare('SELECT * FROM server_members WHERE server_id = ?');
const selectChannelReadState = db.prepare('SELECT last_read_message_id FROM channel_read_states WHERE channel_id = ? AND user_id = ?');
const upsertChannelReadState = db.prepare(`
  INSERT INTO channel_read_states (channel_id, user_id, last_read_message_id) VALUES (?, ?, ?)
  ON CONFLICT(channel_id, user_id) DO UPDATE SET
    last_read_message_id = MAX(channel_read_states.last_read_message_id, excluded.last_read_message_id),
    updated_at = CURRENT_TIMESTAMP
`);
const selectChannelMessageReadReceipt = db.prepare(`
  SELECT
    (SELECT COUNT(*) FROM channel_read_states cr JOIN server_members sm ON sm.user_id = cr.user_id AND sm.server_id = ?
      WHERE cr.channel_id = ? AND cr.last_read_message_id >= ? AND cr.user_id != ?) AS read_count,
    (SELECT COUNT(*) FROM server_members WHERE server_id = ? AND user_id != ?) AS member_count
`);
const listServerMembersDetailed = db.prepare(`
  SELECT sm.*, u.username, u.display_name, u.avatar_url, u.avatar_color, u.avatar_preset
  FROM server_members sm
  JOIN users u ON u.id = sm.user_id
  WHERE sm.server_id = ?
  ORDER BY sm.joined_at ASC
`);
const insertChannel = db.prepare('INSERT INTO channels (server_id, type, name, topic, position) VALUES (?, ?, ?, ?, ?)');
const selectChannelById = db.prepare('SELECT * FROM channels WHERE id = ?');
const listChannelsForServer = db.prepare('SELECT * FROM channels WHERE server_id = ? ORDER BY position ASC, id ASC');
const insertServerMessage = db.prepare('INSERT INTO server_messages (server_id, channel_id, author_id, content, attachment, reply_to_message_id) VALUES (?, ?, ?, ?, ?, ?)');
const selectServerMessageById = db.prepare('SELECT * FROM server_messages WHERE id = ?');
const selectServerMessageWithAuthor = db.prepare(`
  SELECT sm.*, u.username, u.display_name, u.avatar_url, u.avatar_color, u.avatar_preset
  FROM server_messages sm
  JOIN users u ON u.id = sm.author_id
  WHERE sm.id = ?
`);
const listChannelMessages = db.prepare(`
  SELECT sm.*, u.username, u.display_name, u.avatar_url, u.avatar_color
  FROM server_messages sm
  JOIN users u ON u.id = sm.author_id
  WHERE sm.channel_id = ?
  ORDER BY sm.id DESC
  LIMIT ?
  OFFSET ?
`);
const insertServerAttachmentRecord = db.prepare(`
  INSERT INTO server_attachments (id, server_message_id, server_id, channel_id, name, mime, size, path)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);
const selectServerAttachmentById = db.prepare('SELECT * FROM server_attachments WHERE id = ?');
const updateServerProfile = db.prepare('UPDATE servers SET name = ?, description = ?, icon = ? WHERE id = ?');
const selectUserSettings = db.prepare('SELECT * FROM user_settings WHERE user_id = ?');
const insertUserSettings = db.prepare(`
  INSERT INTO user_settings (user_id, theme, accent, background_url, reduce_motion, badges)
  VALUES (?, 'nebula', 'violet', '', 0, '[]')
`);
const updateUserSettings = db.prepare(`
  UPDATE user_settings
  SET theme = ?, accent = ?, background_url = ?, reduce_motion = ?, badges = ?
  WHERE user_id = ?
`);
const selectServerSettings = db.prepare('SELECT * FROM server_settings WHERE server_id = ?');
const insertServerSettings = db.prepare(`
  INSERT INTO server_settings (server_id, default_notifications, verification_level, system_channel_id, banner_url, premium_theme)
  VALUES (?, 'all', 'low', NULL, '', '')
`);
const updateServerSettings = db.prepare(`
  UPDATE server_settings
  SET default_notifications = ?, verification_level = ?, system_channel_id = ?, banner_url = ?, premium_theme = ?
  WHERE server_id = ?
`);
const selectPremiumPlans = db.prepare('SELECT * FROM premium_plans ORDER BY price_cents ASC');
const selectPremiumPlanById = db.prepare('SELECT * FROM premium_plans WHERE id = ?');
const selectPremiumPlanBySlug = db.prepare('SELECT * FROM premium_plans WHERE slug = ?');
const insertPremiumPlan = db.prepare(`
  INSERT INTO premium_plans (slug, name, description, price_cents, currency, perks)
  VALUES (?, ?, ?, ?, ?, ?)
`);
const insertPremiumTransaction = db.prepare(`
  INSERT INTO premium_transactions (user_id, plan_id, amount_cents, currency, status, payment_intent, client_secret)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`);
const selectPremiumTransactionById = db.prepare('SELECT * FROM premium_transactions WHERE id = ?');
const updatePremiumTransactionStatus = db.prepare(`
  UPDATE premium_transactions
  SET status = ?, payment_intent = ?
  WHERE id = ?
`);
const insertPremiumSubscription = db.prepare(`
  INSERT INTO premium_subscriptions (user_id, plan_id, status, started_at, renews_at, metadata)
  VALUES (?, ?, 'active', CURRENT_TIMESTAMP, DATETIME('now', '+30 days'), ?)
`);
const selectPremiumBalance = db.prepare(`
  SELECT SUM(CASE WHEN status = 'succeeded' THEN amount_cents ELSE 0 END) AS available_cents,
         SUM(CASE WHEN status = 'pending' THEN amount_cents ELSE 0 END) AS pending_cents
  FROM premium_transactions
`);
const selectRolesForServer = db.prepare('SELECT * FROM server_roles WHERE server_id = ? ORDER BY position DESC, id DESC');
const selectRoleById = db.prepare('SELECT * FROM server_roles WHERE id = ?');
const insertRole = db.prepare('INSERT INTO server_roles (server_id, name, color, position, permissions, is_default) VALUES (?, ?, ?, ?, ?, ?)');
const updateRole = db.prepare('UPDATE server_roles SET name = ?, color = ?, position = ?, permissions = ?, is_default = ? WHERE id = ?');
const deleteRole = db.prepare('DELETE FROM server_roles WHERE id = ? AND server_id = ?');
const assignRoleToMember = db.prepare('INSERT OR IGNORE INTO server_member_roles (server_id, role_id, user_id) VALUES (?, ?, ?)');
const removeRoleFromMember = db.prepare('DELETE FROM server_member_roles WHERE server_id = ? AND role_id = ? AND user_id = ?');
const selectMemberRoles = db.prepare(`
  SELECT sr.*
  FROM server_member_roles smr
  JOIN server_roles sr ON sr.id = smr.role_id
  WHERE smr.server_id = ? AND smr.user_id = ?
  ORDER BY sr.position DESC
`);
const selectDefaultRole = db.prepare('SELECT * FROM server_roles WHERE server_id = ? AND is_default = 1');
const selectOverride = db.prepare(`
  SELECT * FROM channel_permission_overrides
  WHERE channel_id = ? AND target_type = ? AND target_id = ?
`);
const upsertOverride = db.prepare(`
  INSERT INTO channel_permission_overrides (channel_id, target_type, target_id, allow, deny)
  VALUES (?, ?, ?, ?, ?)
  ON CONFLICT(channel_id, target_type, target_id) DO UPDATE SET allow = excluded.allow, deny = excluded.deny
`);
const deleteOverride = db.prepare(`
  DELETE FROM channel_permission_overrides WHERE channel_id = ? AND target_type = ? AND target_id = ?
`);
const selectOverridesForChannel = db.prepare(`
  SELECT * FROM channel_permission_overrides WHERE channel_id = ?
`);
const selectVoiceSessionsByChannel = db.prepare(`
  SELECT vs.*, u.username, u.display_name, u.avatar_url, u.avatar_color
  FROM voice_sessions vs
  JOIN users u ON u.id = vs.user_id
  WHERE vs.channel_id = ?
  ORDER BY vs.joined_at ASC
`);
const upsertVoiceSession = db.prepare(`
  INSERT INTO voice_sessions (server_id, channel_id, user_id, muted, deafened)
  VALUES (?, ?, ?, ?, ?)
  ON CONFLICT(channel_id, user_id) DO UPDATE SET muted = excluded.muted, deafened = excluded.deafened
`);
const deleteVoiceSession = db.prepare('DELETE FROM voice_sessions WHERE channel_id = ? AND user_id = ?');
const deleteVoiceSessionsForUser = db.prepare('DELETE FROM voice_sessions WHERE user_id = ?');

const PERMISSIONS = {
  ADMIN: 1 << 0,
  MANAGE_SERVER: 1 << 1,
  MANAGE_ROLES: 1 << 2,
  MANAGE_CHANNELS: 1 << 3,
  VIEW_CHANNEL: 1 << 4,
  SEND_MESSAGES: 1 << 5,
  MANAGE_MESSAGES: 1 << 6,
  CONNECT_VOICE: 1 << 7,
  SPEAK_VOICE: 1 << 8,
  STREAM: 1 << 9,
  PRIORITY_SPEAKER: 1 << 10
};

// Existing default community roles receive the baseline permissions needed for voice rooms.
db.prepare('UPDATE server_roles SET permissions = permissions | ? WHERE is_default = 1')
  .run((1 << 7) | (1 << 8) | (1 << 9));

function computeBasePermissions(serverId, userId, cachedRoles = null) {
  const membership = selectServerMember.get(serverId, userId);
  if (!membership) return 0;
  let permissions = 0;
  const roles = cachedRoles ?? selectMemberRoles.all(serverId, userId);
  if (roles.length === 0) {
    const defaultRole = selectDefaultRole.get(serverId);
    if (defaultRole) {
      permissions |= defaultRole.permissions;
    }
  } else {
    roles.forEach((role) => {
      permissions |= role.permissions;
    });
  }
  return permissions;
}

function hasPermission(permissions, required) {
  if ((permissions & PERMISSIONS.ADMIN) === PERMISSIONS.ADMIN) {
    return true;
  }
  return (permissions & required) === required;
}

const defaultPlan = selectPremiumPlanBySlug.get('pulse-monthly');
if (!defaultPlan) {
  insertPremiumPlan.run(
    'pulse-monthly',
    `${PREMIUM_BRAND} Monthly`,
    'Разблокируйте расширенные темы, динамические фоны и значки сообщества.',
    999,
    'USD',
    JSON.stringify([
      'Динамические фоновые сцены',
      'Набор премиальных значков',
      'Буст одного сервера',
      'Расширенные лимиты загрузки'
    ])
  );
}

const selectActiveSubscription = db.prepare(`
  SELECT s.id, s.renews_at, p.id AS plan_id, p.name AS plan_name
  FROM premium_subscriptions s
  JOIN premium_plans p ON p.id = s.plan_id
  WHERE s.user_id = ?
    AND s.status = 'active'
    AND (s.renews_at IS NULL OR s.renews_at > CURRENT_TIMESTAMP)
  ORDER BY s.renews_at DESC
  LIMIT 1
`);

// ---------------------------------------------------------------------------
// Тестовый аккаунт разработчика.
// Нужен, чтобы заходить в приложение с премиум-подпиской без оплаты и проверять
// интерфейс. Это обычный пользователь: админских прав (баны, модерация, доступ
// к чужим данным) он НЕ получает — в проекте такого понятия нет, и мы его не добавляем.
// Включается только флагом NEXO_DEV_ACCOUNT=true (десктоп-сборка из исходников
// включает его сама) и никогда — на боевом веб-деплое (HTTPS), чтобы не создать
// аккаунт с известным паролем на публичном сервере.
// ---------------------------------------------------------------------------
function seedDevAccount() {
  const flag = String(process.env.NEXO_DEV_ACCOUNT || '').toLowerCase();
  if (flag !== 'true' && flag !== '1') return;

  const looksLikePublicDeployment =
    REQUIRE_HTTPS || String(process.env.CLIENT_ORIGIN || '').startsWith('https://');
  if (!isDesktop && looksLikePublicDeployment) {
    console.warn('NEXO_DEV_ACCOUNT ignored: the dev account is never created on a public HTTPS deployment.');
    return;
  }

  const email = String(process.env.NEXO_DEV_EMAIL || 'dev@nexo.local').trim().toLowerCase();
  const configuredPassword = process.env.NEXO_DEV_PASSWORD || '';
  let user = selectUserByEmail.get(email);

  if (!user) {
    const password = configuredPassword || randomBytes(12).toString('base64url');
    const result = insertUser.run(
      email,
      generateHandleFromEmail(email),
      bcrypt.hashSync(password, 12),
      '',
      1,
      0,
      null
    );
    user = selectUserById.get(result.lastInsertRowid);
    markProfile.run('Nexo Dev', user.username, '0001', '', '#D97757', 0, 0, 'Nexo Dev', user.username, user.id);
    user = selectUserById.get(user.id);

    if (configuredPassword) {
      console.log(`Dev account created: ${email} (password from NEXO_DEV_PASSWORD)`);
    } else {
      // Сгенерированный пароль в логи не пишем — только в файл, доступный владельцу.
      const credentialsFile = path.join(dataDir, 'dev-account.txt');
      fs.writeFileSync(credentialsFile, `email: ${email}\npassword: ${password}\n`, { mode: 0o600 });
      console.log(`Dev account created: ${email} (password saved to ${credentialsFile})`);
    }
  } else if (configuredPassword && !bcrypt.compareSync(configuredPassword, user.password_hash || '')) {
    // Пароль из окружения — источник истины: меняем его в аккаунте, если он поменялся
    updatePasswordHash.run(bcrypt.hashSync(configuredPassword, 12), user.id);
    console.log('Dev account password updated from NEXO_DEV_PASSWORD.');
  }

  // Значки профиля
  const settings = getUserSettings(user.id);
  const badges = Array.from(new Set([...settings.badges, 'dev', 'premium']));
  updateUserSettings.run(
    settings.theme,
    settings.accent,
    settings.background_url,
    settings.reduce_motion ? 1 : 0,
    JSON.stringify(badges),
    user.id
  );

  // Бессрочная премиум-подписка без записей об оплате (баланс и транзакции не затрагиваются)
  const plan = selectPremiumPlanBySlug.get('pulse-monthly');
  if (plan) {
    const hasDevSubscription = db
      .prepare(`SELECT id FROM premium_subscriptions WHERE user_id = ? AND status = 'active' AND metadata LIKE '%"dev":true%'`)
      .get(user.id);
    if (!hasDevSubscription) {
      db.prepare(`
        INSERT INTO premium_subscriptions (user_id, plan_id, status, started_at, renews_at, metadata)
        VALUES (?, ?, 'active', CURRENT_TIMESTAMP, DATETIME('now', '+100 years'), ?)
      `).run(user.id, plan.id, JSON.stringify({ dev: true }));
    }
  }
}

seedDevAccount();

const allowedOrigins = (process.env.CLIENT_ORIGIN || process.env.CORS_ORIGIN || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

// Добавляем localhost и 127.0.0.1 для Electron приложения
if (!allowedOrigins.includes('http://localhost:4000')) {
  allowedOrigins.push('http://localhost:4000');
}
if (!allowedOrigins.includes('http://127.0.0.1:4000')) {
  allowedOrigins.push('http://127.0.0.1:4000');
}

// Десктопный сервер никогда не стоит за прокси: иначе X-Forwarded-For подделывается клиентом
// и обходит лимиты по IP. Для веб-деплоя число доверенных прокси задаётся TRUST_PROXY (по умолчанию 1).
app.set('trust proxy', isDesktop ? false : Number(process.env.TRUST_PROXY ?? 1));

if (REQUIRE_HTTPS) {
  app.use((req, res, next) => {
    if (req.secure || req.headers['x-forwarded-proto'] === 'https') {
      return next();
    }
    const host = req.headers.host || '';
    return res.redirect(301, `https://${host}${req.originalUrl}`);
  });
}
app.use(
  helmet({
    crossOriginOpenerPolicy: { policy: 'same-origin' },
    crossOriginEmbedderPolicy: { policy: 'credentialless' }
  })
);

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.length === 0 || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    return callback(new Error('Not allowed by CORS'));
  },
  credentials: true
}));

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));
app.use(mongoSanitize());
app.use(hpp());

// Rate limiting configuration
const createRateLimiter = (
  windowMs,
  max,
  message,
  keyGen = (req) => req.ip,
  skipFailedRequests = true
) => rateLimit({
  windowMs,
  max,
  message: { message },
  standardHeaders: true,
  legacyHeaders: false,
  skipFailedRequests,
  keyGenerator: keyGen
});

// Rate limiters for different endpoints
// Для входа/регистрации считаем и неудачные попытки, иначе брутфорс пароля не ограничивается.
const authLimiter = createRateLimiter(
  15 * 60 * 1000,
  20,
  'Too many login attempts, please try again later',
  undefined,
  false
);

const apiLimiter = createRateLimiter(
  15 * 60 * 1000, 
  100, 
  'Too many requests, please try again later'
);

const strictLimiter = createRateLimiter(
  60 * 1000, 
  10, 
  'Too many requests, please slow down'
);

const userScopedKey = (req) => (req.user?.id ? `user:${req.user.id}` : req.ip);

const messageLimiter = createRateLimiter(
  15 * 1000, 
  40, 
  'You are sending messages too quickly',
  userScopedKey
);

const friendActionLimiter = createRateLimiter(
  15 * 60 * 1000,
  30,
  'Too many friend actions, please try again later',
  userScopedKey
);

app.use(['/api/auth/login', '/api/auth/register', '/api/auth/github'], authLimiter);

const clientIsHttps = String(process.env.CLIENT_ORIGIN || '').startsWith('https://');

const sessionConfig = {
  store: useSQLiteSession
    ? new SQLiteSessionStore(db)
    : new RedisStore({
        client: redisClient,
        prefix: process.env.SESSION_PREFIX || 'nexo:sess:'
      }),
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: {
    httpOnly: true,
    // Раньше secure=true ставился всегда в production. По http (десктоп на 127.0.0.1 и локальный
    // `npm run dev`) express-session такую cookie не отправляет вообще, и сессия не сохранялась.
    // 'auto' ставит Secure только на HTTPS-соединении (за прокси — по X-Forwarded-Proto).
    // sameSite=none нужен только для боевого деплоя с HTTPS-клиентом, иначе используем lax.
    sameSite: isDesktop ? 'lax' : isProduction && clientIsHttps ? 'none' : 'lax',
    secure: isDesktop ? false : 'auto',
    maxAge: Number(process.env.SESSION_TTL_MS || 1000 * 60 * 60 * 24 * 7)
  }
};

const sessionMiddleware = session(sessionConfig);
app.use(sessionMiddleware);
app.use(passport.initialize());
app.use(passport.session());

const csrfProtection = csrf({
  cookie: false,
  ignoreMethods: ['GET', 'HEAD', 'OPTIONS']
});

// Применяем CSRF middleware, но делаем исключение для API в разработке и Electron
app.use((req, res, next) => {
  const isDev = process.env.NODE_ENV === 'development';
  const isElectron = process.env.ELECTRON_DESKTOP === '1';
  
  if ((isDev || isElectron) && req.path.startsWith('/api/')) {
    // В разработке и Electron csurf пропускаем, но состояние-меняющие запросы всё равно
    // защищаем проверкой Origin: чужой сайт не сможет отправить форму на локальный сервер.
    const isSafeMethod = ['GET', 'HEAD', 'OPTIONS'].includes(req.method);
    const requestOrigin = req.headers.origin;
    if (!isSafeMethod && requestOrigin && !allowedOrigins.includes(requestOrigin)) {
      return res.status(403).json({ message: 'Origin not allowed.' });
    }
    req.csrfToken = () => isElectron ? 'electron-csrf-token' : 'dev-csrf-token';
    return next();
  }
  return csrfProtection(req, res, next);
});

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      cb(null, tempUploadsDir);
    },
    filename: (_req, file, cb) => {
      const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
      const ext = path.extname(file.originalname)?.toLowerCase() || '';
      cb(null, `${uniqueSuffix}${ext}`);
    }
  }),
  limits: {
    fileSize: Number(process.env.MAX_UPLOAD_BYTES || 25 * 1024 * 1024)
  }
});

// Initialize Socket.IO with CORS
// Initialize Socket.IO after session middleware
const io = new Server(server, {
  cors: {
    origin: process.env.NODE_ENV === 'production'
      ? process.env.CLIENT_ORIGIN
      : ['http://localhost:3000', 'http://localhost:5173', 'http://localhost:4000', 'http://127.0.0.1:4000'],
    methods: ['GET', 'POST'],
    credentials: true
  },
  pingTimeout: 60000,
  pingInterval: 25000,
  connectionStateRecovery: {
    // Enable connection state recovery with 2 minutes timeout
    maxDisconnectionDuration: 2 * 60 * 1000,
    skipMiddlewares: true
  }
});

io.use((socket, next) => {
  sessionMiddleware(socket.request, {}, () => {
    const userId = socket.request.session?.passport?.user;
    if (!userId) {
      return next(new Error('Unauthorized'));
    }
    socket.user = sanitizeUser(selectUserById.get(userId));
    if (!socket.user) {
      return next(new Error('Unauthorized'));
    }
    return next();
  });
});

io.on('connection', (socket) => {
  socket.join(getUserRoom(socket.user.id));
  socket.emit('socket:ready', { user: socket.user });

  let lastTypingAt = 0;
  socket.on('typing', ({ conversationId, isTyping }) => {
    try {
      ensureConversationAccess(Number(conversationId), socket.user.id);
      const now = Date.now();
      if (isTyping && now - lastTypingAt < 900) return;
      lastTypingAt = now;
      socket.to(getConversationRoom(Number(conversationId))).emit('typing', {
        conversationId: Number(conversationId),
        user: socket.user,
        isTyping: Boolean(isTyping)
      });
    } catch (error) {
      socket.emit('error', { message: error.message });
    }
  });


  socket.on('conversation:join', (conversationId) => {
    try {
      ensureConversationAccess(conversationId, socket.user.id);
      socket.join(getConversationRoom(conversationId));
    } catch (error) {
      socket.emit('error', { message: error.message });
    }
  });

  socket.on('conversation:leave', (conversationId) => {
    socket.leave(getConversationRoom(conversationId));
  });

  socket.on('message:send', ({ conversationId, content }) => {
    try {
      const message = createMessage(conversationId, socket.user.id, content);
      socket.emit('message:ack', { conversationId, message });
    } catch (error) {
      socket.emit('error', { message: error.message });
    }
  });

  const handleCallRing = ({ conversationId, mediaType = 'audio' }) => {
    try {
      ensureConversationAccess(Number(conversationId), socket.user.id);
      const participants = getConversationParticipants(Number(conversationId));
      if (participants.length > 2) {
        socket.emit('call:error', { conversationId: Number(conversationId), message: 'Групповые звонки до четырёх участников ещё проходят разработку. Пока доступны личные звонки.' });
        return;
      }
      const invitation = {
        conversationId: Number(conversationId), from: socket.user.id, user: sanitizeUser(socket.user),
        mediaType: mediaType === 'video' ? 'video' : 'audio',
        participants
      };
      participants.filter((participant) => participant.id !== socket.user.id).forEach((participant) => {
        io.to(getUserRoom(participant.id)).emit('call:ring', invitation);
        io.to(getUserRoom(participant.id)).emit('call:invite', invitation);
      });
    } catch (error) { socket.emit('error', { message: error.message }); }
  };
  socket.on('call:ring', handleCallRing);
  socket.on('call:invite', handleCallRing);

  socket.on('call:accept', ({ conversationId, mediaType = 'audio' }) => {
    try {
      ensureConversationAccess(conversationId, socket.user.id);
      const accepted = {
        conversationId,
        from: socket.user.id,
        mediaType: mediaType === 'video' ? 'video' : 'audio'
      };
      getConversationParticipants(conversationId)
        .filter((participant) => participant.id !== socket.user.id)
        .forEach((participant) => io.to(getUserRoom(participant.id)).emit('call:accept', accepted));
    } catch (error) {
      socket.emit('error', { message: error.message });
    }
  });

  const handleCallDecline = ({ conversationId }) => {
    try {
      ensureConversationAccess(Number(conversationId), socket.user.id);
      getConversationParticipants(Number(conversationId)).filter((participant) => participant.id !== socket.user.id).forEach((participant) => {
        const payload = { conversationId: Number(conversationId), from: socket.user.id };
        io.to(getUserRoom(participant.id)).emit('call:decline', payload);
        io.to(getUserRoom(participant.id)).emit('call:reject', payload);
      });
    } catch (error) { socket.emit('error', { message: error.message }); }
  };
  socket.on('call:decline', handleCallDecline);
  socket.on('call:reject', handleCallDecline);

  socket.on('call:timeout', ({ conversationId }) => {
    try {
      ensureConversationAccess(Number(conversationId), socket.user.id);
      getConversationParticipants(Number(conversationId))
        .filter((participant) => participant.id !== socket.user.id)
        .forEach((participant) => io.to(getUserRoom(participant.id)).emit('call:timeout', {
          conversationId: Number(conversationId), from: socket.user.id
        }));
    } catch (error) { socket.emit('error', { message: error.message }); }
  });

  socket.on('call:signal', ({ conversationId, payload }) => {
    try {
      ensureConversationAccess(conversationId, socket.user.id);
      socket.to(getConversationRoom(conversationId)).emit('call:signal', {
        conversationId,
        from: socket.user.id,
        payload
      });
    } catch (error) {
      socket.emit('error', { message: error.message });
    }
  });

  socket.on('call:end', ({ conversationId }) => {
    try {
      ensureConversationAccess(Number(conversationId), socket.user.id);
      getConversationParticipants(Number(conversationId))
        .filter((participant) => participant.id !== socket.user.id)
        .forEach((participant) => io.to(getUserRoom(participant.id)).emit('call:end', {
          conversationId: Number(conversationId), from: socket.user.id
        }));
    } catch (error) {
      socket.emit('error', { message: error.message });
    }
  });

  socket.on('server:join', (serverId) => {
    try {
      ensureServerMembership(Number(serverId), socket.user.id);
      socket.join(getServerRoom(serverId));
    } catch (error) {
      socket.emit('error', { message: error.message });
    }
  });

  socket.on('server:leave', (serverId) => {
    socket.leave(getServerRoom(serverId));
  });

  socket.on('channel:join', ({ serverId, channelId }) => {
    try {
      const { channel, permissions } = ensureChannelAccess(Number(serverId), Number(channelId), socket.user.id);
      if (channel.type === 'voice' && !hasPermission(permissions, PERMISSIONS.VIEW_CHANNEL | PERMISSIONS.CONNECT_VOICE)) {
        throw new Error('Недостаточно прав для подключения к голосовому каналу.');
      }
      socket.join(getChannelRoom(channelId));
      if (channel.type === 'voice') {
        const session = db.prepare('SELECT id FROM voice_sessions WHERE channel_id = ? AND user_id = ?').get(Number(channelId), socket.user.id);
        if (session) socket.emit('voice:peers', {
          channelId: Number(channelId),
          peers: listVoiceParticipants(Number(channelId)).filter((participant) => participant.user.id !== socket.user.id)
        });
      }
    } catch (error) {
      socket.emit('error', { message: error.message });
    }
  });

  socket.on('voice:invite', ({ serverId, channelId, to }) => {
    const safeServerId = Number(serverId);
    const safeChannelId = Number(channelId);
    const recipientId = Number(to);
    if (![safeServerId, safeChannelId, recipientId].every(Number.isInteger) || recipientId === socket.user.id) return;
    try {
      const { channel, server, permissions } = ensureChannelAccess(safeServerId, safeChannelId, socket.user.id);
      if (channel.type !== 'voice' || !hasPermission(permissions, PERMISSIONS.CONNECT_VOICE)) {
        return socket.emit('error', { message: 'Недостаточно прав для приглашения в голосовой канал.' });
      }
      const activeSession = db.prepare('SELECT id FROM voice_sessions WHERE channel_id = ? AND user_id = ?').get(safeChannelId, socket.user.id);
      if (!activeSession) return socket.emit('error', { message: 'Сначала подключитесь к голосовому каналу.' });
      const recipient = selectServerMember.get(safeServerId, recipientId);
      if (!recipient) return socket.emit('error', { message: 'Пригласить можно только участника этого пространства.' });
      try {
        const recipientAccess = ensureChannelAccess(safeServerId, safeChannelId, recipientId);
        if (!hasPermission(recipientAccess.permissions, PERMISSIONS.VIEW_CHANNEL | PERMISSIONS.CONNECT_VOICE)) {
          return socket.emit('error', { message: 'У участника нет доступа к этому голосовому каналу.' });
        }
      } catch { return socket.emit('error', { message: 'У участника нет доступа к этому каналу.' }); }
      io.to(getUserRoom(recipientId)).emit('voice:invite', {
        serverId: safeServerId, channelId: safeChannelId, serverName: server.name,
        channelName: channel.name, from: socket.user.id, user: sanitizeUser(socket.user)
      });
    } catch (error) { socket.emit('error', { message: error.message }); }
  });

  socket.on('voice:invite-response', ({ to, channelId, accepted }) => {
    const recipientId = Number(to);
    const safeChannelId = Number(channelId);
    if (!Number.isInteger(recipientId) || !Number.isInteger(safeChannelId)) return;
    io.to(getUserRoom(recipientId)).emit('voice:invite-response', {
      channelId: safeChannelId, from: socket.user.id, accepted: Boolean(accepted)
    });
  });

  socket.on('voice:signal', ({ channelId, to, payload }) => {
    const safeChannelId = Number(channelId);
    const recipientId = Number(to);
    if (!Number.isInteger(safeChannelId) || !Number.isInteger(recipientId) || !payload) return;
    try {
      const serverId = Number(db.prepare('SELECT server_id FROM channels WHERE id = ?').get(safeChannelId)?.server_id);
      const access = ensureChannelAccess(serverId, safeChannelId, socket.user.id);
      if (!hasPermission(access.permissions, PERMISSIONS.VIEW_CHANNEL | PERMISSIONS.CONNECT_VOICE)) return socket.emit('error', { message: 'Недостаточно прав для голосового канала.' });
      if (typeof payload.sdp === 'string' && payload.sdp.includes('m=video') && !hasPermission(access.permissions, PERMISSIONS.STREAM)) {
        return socket.emit('error', { message: 'У вас нет права передавать видео или экран в этом канале.' });
      }
      const sender = db.prepare('SELECT id FROM voice_sessions WHERE channel_id = ? AND user_id = ?').get(safeChannelId, socket.user.id);
      const recipient = db.prepare('SELECT id FROM voice_sessions WHERE channel_id = ? AND user_id = ?').get(safeChannelId, recipientId);
      if (!sender || !recipient) return socket.emit('error', { message: 'Участник больше не находится в голосовом канале.' });
      const encodedSize = Buffer.byteLength(JSON.stringify(payload), 'utf8');
      if (encodedSize > 256 * 1024) return socket.emit('error', { message: 'Слишком большой сигнал WebRTC.' });
      io.to(getUserRoom(recipientId)).emit('voice:signal', { channelId: safeChannelId, from: socket.user.id, payload });
    } catch (error) {
      socket.emit('error', { message: error.message });
    }
  });

  socket.on('disconnect', () => {
    const sessions = db.prepare('SELECT channel_id FROM voice_sessions WHERE user_id = ?').all(socket.user.id);
    if (!sessions.length) return;
    deleteVoiceSessionsForUser.run(socket.user.id);
    sessions.forEach(({ channel_id }) => {
      io.to(getChannelRoom(channel_id)).emit('voice:left', { channelId: channel_id, userId: socket.user.id });
      broadcastVoiceState(channel_id);
    });
  });

  socket.on('channel:leave', (channelId) => {
    socket.leave(getChannelRoom(channelId));
  });
});

function sanitizeUser(user) {
  if (!user) return null;
  const { password_hash, twofa_secret, ...rest } = user;
  return rest;
}

function broadcastUserUpdate(updatedUser) {
  if (!updatedUser || !io) return;
  const links = listFriendships.all(updatedUser.id, updatedUser.id)
    .filter((friendship) => friendship.status === 'accepted');
  const recipients = new Set();
  for (const link of links) {
    recipients.add(link.requester_id === updatedUser.id ? link.addressee_id : link.requester_id);
  }
  for (const recipientId of recipients) {
    io.to(getUserRoom(recipientId)).emit('user:update', { user: updatedUser });
  }
  io.to(getUserRoom(updatedUser.id)).emit('user:update', { user: updatedUser });
}

function ensureAuthenticated(req, res, next) {
  if (req.isAuthenticated && req.isAuthenticated()) {
    return next();
  }
  return res.status(401).json({ message: 'Not authenticated.' });
}

app.post('/api/servers/:serverId/roles', ensureAuthenticated, (req, res) => {
  const serverId = Number(req.params.serverId);
  if (!Number.isFinite(serverId)) {
    return res.status(400).json({ message: 'Invalid server id.' });
  }
  const { name, color, permissions } = req.body || {};
  if (!name || typeof name !== 'string') {
    return res.status(400).json({ message: 'Role name is required.' });
  }
  try {
    ensureServerOwnership(serverId, req.user.id);
    const position = selectRolesForServer.all(serverId).length + 1;
    insertRole.run(
      serverId,
      name.slice(0, 48),
      (color || '#ffffff').slice(0, 7),
      position,
      Number.isFinite(permissions) ? permissions : 0,
      0
    );
    broadcastServerUpdate(serverId);
    const server = selectServerById.get(serverId);
    return res.status(201).json({ server: serializeServerEntity(server, req.user.id) });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ message: error.message });
  }
});

app.put('/api/servers/:serverId/roles/:roleId', ensureAuthenticated, (req, res) => {
  const serverId = Number(req.params.serverId);
  const roleId = Number(req.params.roleId);
  if (!Number.isFinite(serverId) || !Number.isFinite(roleId)) {
    return res.status(400).json({ message: 'Invalid identifiers.' });
  }
  const role = selectRoleById.get(roleId);
  if (!role || role.server_id !== serverId) {
    return res.status(404).json({ message: 'Role not found.' });
  }
  try {
    ensureServerOwnership(serverId, req.user.id);
    const payload = req.body || {};
    updateRole.run(
      payload.name ? payload.name.slice(0, 48) : role.name,
      payload.color ? payload.color.slice(0, 7) : role.color,
      Number.isFinite(payload.position) ? payload.position : role.position,
      Number.isFinite(payload.permissions) ? payload.permissions : role.permissions,
      payload.is_default ? 1 : role.is_default,
      roleId
    );
    broadcastServerUpdate(serverId);
    const server = selectServerById.get(serverId);
    return res.json({ server: serializeServerEntity(server, req.user.id) });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ message: error.message });
  }
});

app.delete('/api/servers/:serverId/roles/:roleId', ensureAuthenticated, (req, res) => {
  const serverId = Number(req.params.serverId);
  const roleId = Number(req.params.roleId);
  if (!Number.isFinite(serverId) || !Number.isFinite(roleId)) {
    return res.status(400).json({ message: 'Invalid identifiers.' });
  }
  const role = selectRoleById.get(roleId);
  if (!role || role.server_id !== serverId) {
    return res.status(404).json({ message: 'Role not found.' });
  }
  if (role.is_default) {
    return res.status(400).json({ message: 'Cannot delete the default role.' });
  }
  try {
    ensureServerOwnership(serverId, req.user.id);
    deleteRole.run(roleId, serverId);
    broadcastServerUpdate(serverId);
    const server = selectServerById.get(serverId);
    return res.json({ server: serializeServerEntity(server, req.user.id) });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ message: error.message });
  }
});

function normalizeHandle(value = '') {
  return value.toLowerCase().replace(/[^a-z0-9._-]/g, '').slice(0, 24);
}

const AVATAR_PALETTE = ['#D97757', '#B66F83', '#788CB8', '#6F9B86', '#B18A55', '#897CB4', '#5F9EAA', '#9A806D', '#7E9670'];
function defaultAvatarColor(handle = '') {
  let hash = 0;
  for (const character of String(handle).toLowerCase()) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return AVATAR_PALETTE[hash % AVATAR_PALETTE.length];
}

function randomDiscriminator() {
  return String(Math.floor(1000 + Math.random() * 9000));
}

function generateUniqueHandle(seed) {
  const base = normalizeHandle(seed) || `user${Date.now()}`;
  let attempt = 0;
  let candidate = base;
  while (selectUserByUsername.get(candidate)) {
    attempt += 1;
    candidate = `${base}${attempt}`;
  }
  return candidate;
}

function generateHandleFromEmail(email) {
  const localPart = email.includes('@') ? email.split('@')[0] : email;
  return generateUniqueHandle(localPart);
}

function hydrateFriendship(record, currentUserId) {
  if (!record) return null;
  const direction = record.requester_id === currentUserId ? 'outgoing' : 'incoming';
  const counterpartId = direction === 'outgoing' ? record.addressee_id : record.requester_id;
  const counterpart = sanitizeUser(selectUserById.get(counterpartId));

  return {
    id: record.id,
    status: record.status,
    direction,
    created_at: record.created_at,
    user: counterpart
  };
}

function serializeAttachment(raw) {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function getMessageReply(scope, replyToMessageId) {
  if (!replyToMessageId) return null;
  const row = scope === 'dm'
    ? db.prepare(`
        SELECT m.id, m.content, m.attachment, u.id AS author_id, u.username, u.display_name
        FROM messages m JOIN users u ON u.id = m.author_id WHERE m.id = ?
      `).get(replyToMessageId)
    : db.prepare(`
        SELECT sm.id, sm.content, sm.attachment, u.id AS author_id, u.username, u.display_name
        FROM server_messages sm JOIN users u ON u.id = sm.author_id WHERE sm.id = ?
      `).get(replyToMessageId);
  if (!row) return null;
  return {
    id: row.id,
    content: row.content || (row.attachment ? (serializeAttachment(row.attachment)?.name || 'Вложение') : ''),
    author: { id: row.author_id, username: row.username, display_name: row.display_name }
  };
}

function getMessagePin(scope, messageId) {
  const row = selectMessagePin.get(scope, messageId);
  return row ? { pinned_at: row.pinned_at, pinned_by: row.pinned_by } : null;
}

function getMessageReactions(scope, messageId) {
  return listMessageReactions.all(scope, messageId).map((row) => ({
    emoji: row.emoji,
    count: Number(row.count),
    user_ids: row.user_ids ? row.user_ids.split(',').map(Number) : []
  }));
}

function getMessageDelivery(row) {
  if (!row?.conversation_id || !row?.id || !row?.author_id) return null;
  const result = selectMessageDeliverySummary.get(row.conversation_id, row.id, row.conversation_id, row.author_id);
  return { delivered_count: Number(result?.delivered_count || 0), recipient_count: Number(result?.recipient_count || 0) };
}

function serializeMessage(row) {
  if (!row) return null;
  return {
    id: row.id,
    conversation_id: row.conversation_id,
    author: {
      id: row.author_id,
      username: row.username,
      display_name: row.display_name,
      avatar_url: row.avatar_url,
      avatar_color: row.avatar_color || '#D97757',
      avatar_preset: Number.isInteger(row.avatar_preset) ? row.avatar_preset : 0
    },
    content: row.content,
    attachment: serializeAttachment(row.attachment),
    created_at: row.created_at,
    edited_at: row.edited_at || null,
    reactions: getMessageReactions('dm', row.id),
    reply_to: getMessageReply('dm', row.reply_to_message_id),
    pin: getMessagePin('dm', row.id),
    delivery: getMessageDelivery(row)
  };
}

function getChannelMessageReadReceipt(row) {
  if (!row?.channel_id || !row?.server_id || !row?.id || !row?.author_id) return null;
  const result = selectChannelMessageReadReceipt.get(row.server_id, row.channel_id, row.id, row.author_id, row.server_id, row.author_id);
  return { read_count: Number(result?.read_count || 0), member_count: Number(result?.member_count || 0) };
}

function serializeServerMessage(row) {
  if (!row) return null;
  return {
    id: row.id,
    server_id: row.server_id,
    channel_id: row.channel_id,
    author: {
      id: row.author_id,
      username: row.username,
      display_name: row.display_name,
      avatar_url: row.avatar_url,
      avatar_color: row.avatar_color || '#D97757',
      avatar_preset: Number.isInteger(row.avatar_preset) ? row.avatar_preset : 0
    },
    content: row.content,
    attachment: serializeAttachment(row.attachment),
    created_at: row.created_at,
    edited_at: row.edited_at || null,
    reactions: getMessageReactions('channel', row.id),
    reply_to: getMessageReply('channel', row.reply_to_message_id),
    pin: getMessagePin('channel', row.id),
    read_receipt: getChannelMessageReadReceipt(row)
  };
}

function getConversationParticipants(conversationId) {
  const users = selectParticipants.all(conversationId).map((user) => sanitizeUser(user));
  return users;
}

function serializeConversation(conversation, currentUserId) {
  if (!conversation) return null;
  const participants = getConversationParticipants(conversation.id);
  const counterpart =
    conversation.type === 'dm'
      ? participants.find((participant) => participant.id !== currentUserId)
      : null;

  return {
    id: conversation.id,
    type: conversation.type,
    title: conversation.title || (counterpart?.display_name || counterpart?.username),
    participants,
    counterpart,
    last_message: serializeMessage(selectLastMessageForConversation.get(conversation.id)),
    updated_at: conversation.updated_at
  };
}

function ensureServerMembership(serverId, userId) {
  const server = selectServerById.get(serverId);
  if (!server) {
    const error = new Error('Server not found');
    error.statusCode = 404;
    throw error;
  }
  const membership = selectServerMember.get(serverId, userId);
  if (!membership) {
    const error = new Error('Forbidden');
    error.statusCode = 403;
    throw error;
  }
  return { server, membership };
}

function ensureServerOwnership(serverId, userId) {
  const { server } = ensureServerMembership(serverId, userId);
  if (server.owner_id !== userId) {
    const permissions = computeBasePermissions(serverId, userId);
    if (!hasPermission(permissions, PERMISSIONS.ADMIN | PERMISSIONS.MANAGE_SERVER)) {
      const error = new Error('Insufficient permissions.');
      error.statusCode = 403;
      throw error;
    }
  }
  return server;
}

function ensurePermission(serverId, userId, required) {
  const permissions = computeBasePermissions(serverId, userId);
  if (!hasPermission(permissions, required)) {
    const error = new Error('Insufficient permissions.');
    error.statusCode = 403;
    throw error;
  }
  return permissions;
}

function ensureChannelAccess(serverId, channelId, userId) {
  const channel = selectChannelById.get(channelId);
  if (!channel || channel.server_id !== serverId) {
    const error = new Error('Channel not found');
    error.statusCode = 404;
    throw error;
  }
  const { server, membership } = ensureServerMembership(serverId, userId);
  const memberRoles = selectMemberRoles.all(server.id, userId);
  const basePermissions = computeBasePermissions(server.id, userId, memberRoles);
  const overrides = selectOverridesForChannel.all(channel.id);
  let permissions = basePermissions;

  overrides.forEach((override) => {
    if (override.target_type === 'role') {
      const hasRole = memberRoles.some((role) => role.id === override.target_id);
      if (hasRole) {
        permissions &= ~override.deny;
        permissions |= override.allow;
      }
    } else if (override.target_type === 'member' && override.target_id === userId) {
      permissions &= ~override.deny;
      permissions |= override.allow;
    }
  });

  return { server, membership, channel, permissions };
}

function serializeChannel(channel, currentUserId = null) {
  if (!channel) return null;
  const overrides = selectOverridesForChannel.all(channel.id).map((override) => ({
    target_type: override.target_type,
    target_id: override.target_id,
    allow: override.allow,
    deny: override.deny
  }));
  return {
    id: channel.id,
    server_id: channel.server_id,
    type: channel.type,
    name: channel.name,
    topic: channel.topic,
    position: channel.position,
    slow_mode_seconds: channel.slow_mode_seconds || 0,
    is_nsfw: Boolean(channel.is_nsfw),
    bitrate: channel.bitrate || 64000,
    user_limit: channel.user_limit || 0,
    soundscape: channel.soundscape || '',
    ...(channel.type === 'voice' && Number.isInteger(currentUserId) ? (() => {
      try {
        const access = ensureChannelAccess(channel.server_id, channel.id, currentUserId);
        return {
          canConnect: hasPermission(access.permissions, PERMISSIONS.VIEW_CHANNEL | PERMISSIONS.CONNECT_VOICE),
          canSpeak: hasPermission(access.permissions, PERMISSIONS.SPEAK_VOICE),
          canStream: hasPermission(access.permissions, PERMISSIONS.STREAM)
        };
      } catch { return { canConnect: false, canSpeak: false, canStream: false }; }
    })() : {}),
    overrides,
    created_at: channel.created_at
  };
}

function serializeServerEntity(server, currentUserId) {
  if (!server) return null;
  const channels = listChannelsForServer.all(server.id).map((channel) => serializeChannel(channel, currentUserId));
  const roles = selectRolesForServer.all(server.id).map((role) => ({
    id: role.id,
    name: role.name,
    color: role.color,
    position: role.position,
    permissions: role.permissions,
    is_default: Boolean(role.is_default)
  }));
  const membership = selectServerMember.get(server.id, currentUserId);
  return {
    id: server.id,
    name: server.name,
    icon: server.icon,
    description: server.description,
    owner_id: server.owner_id,
    role: membership?.role || 'member',
    roles,
    channels,
    created_at: server.created_at
  };
}

function listServerMembersSerialized(serverId) {
  return listServerMembersDetailed.all(serverId).map((member) => ({
    id: member.id,
    user: {
      id: member.user_id,
      username: member.username,
      display_name: member.display_name,
      avatar_url: member.avatar_url,
      avatar_color: member.avatar_color || '#D97757'
    },
    role: member.role,
    nickname: member.nickname,
    joined_at: member.joined_at,
    roles: selectMemberRoles.all(serverId, member.user_id).map((role) => ({
      id: role.id,
      name: role.name,
      color: role.color,
      position: role.position
    }))
  }));
}

function normalizeBadges(raw) {
  if (!raw) return [];
  try {
    const value = JSON.parse(raw);
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function getUserSettings(userId) {
  let settings = selectUserSettings.get(userId);
  if (!settings) {
    insertUserSettings.run(userId);
    settings = selectUserSettings.get(userId);
  }
  return {
    theme: settings.theme,
    accent: settings.accent,
    background_url: settings.background_url,
    reduce_motion: Boolean(settings.reduce_motion),
    badges: normalizeBadges(settings.badges)
  };
}

function updateUserSettingsRecord(userId, payload) {
  const allowedThemes = ['light', 'dark', 'system'];
  const allowedAccents = ['terracotta'];
  const theme = allowedThemes.includes(payload.theme) ? payload.theme : 'system';
  const accent = allowedAccents.includes(payload.accent) ? payload.accent : 'terracotta';
  const background = (payload.background_url || '').trim().slice(0, 512);
  const reduceMotion = payload.reduce_motion ? 1 : 0;
  const badges = JSON.stringify(payload.badges || []);
  updateUserSettings.run(theme, accent, background, reduceMotion, badges, userId);
  return getUserSettings(userId);
}

function getServerSettings(serverId) {
  let settings = selectServerSettings.get(serverId);
  if (!settings) {
    insertServerSettings.run(serverId);
    settings = selectServerSettings.get(serverId);
  }
  return {
    default_notifications: settings.default_notifications,
    verification_level: settings.verification_level,
    system_channel_id: settings.system_channel_id,
    banner_url: settings.banner_url,
    premium_theme: settings.premium_theme
  };
}

function updateServerSettingsRecord(serverId, payload) {
  const notifications = ['all', 'mentions'].includes(payload.default_notifications)
    ? payload.default_notifications
    : 'all';
  const verificationLevels = ['none', 'low', 'medium', 'high'];
  const verification = verificationLevels.includes(payload.verification_level)
    ? payload.verification_level
    : 'low';
  let systemChannelId = null;
  if (Number.isFinite(payload.system_channel_id)) {
    const channel = selectChannelById.get(payload.system_channel_id);
    if (channel && channel.server_id === serverId) {
      systemChannelId = channel.id;
    }
  }
  const banner = (payload.banner_url || '').trim().slice(0, 512);
  const premiumTheme = (payload.premium_theme || '').trim().slice(0, 120);
  updateServerSettings.run(
    notifications,
    verification,
    systemChannelId,
    banner,
    premiumTheme,
    serverId
  );
  return getServerSettings(serverId);
}

function listVoiceParticipants(channelId) {
  return selectVoiceSessionsByChannel.all(channelId).map((session) => {
    let canSpeak = false;
    let canStream = false;
    try {
      const access = ensureChannelAccess(session.server_id, channelId, session.user_id);
      canSpeak = hasPermission(access.permissions, PERMISSIONS.SPEAK_VOICE);
      canStream = hasPermission(access.permissions, PERMISSIONS.STREAM);
    } catch {}
    return {
      user: {
        id: session.user_id,
        username: session.username,
        display_name: session.display_name,
        avatar_url: session.avatar_url,
        avatar_color: session.avatar_color || '#D97757'
      },
      muted: Boolean(session.muted),
      deafened: Boolean(session.deafened),
      canSpeak,
      canStream,
      joined_at: session.joined_at
    };
  });
}

function broadcastVoiceState(channelId) {
  const participants = listVoiceParticipants(channelId);
  io.to(getChannelRoom(channelId)).emit('voice:state', {
    channelId,
    participants
  });
}

app.get('/api/security/csrf-token', (req, res) => {
  // В режиме разработки CSRF отключен для API, возвращаем фиктивный токен
  if (process.env.NODE_ENV === 'development') {
    return res.json({ token: 'dev-csrf-token-disabled' });
  }
  // В production используем реальный CSRF токен
  if (typeof req.csrfToken === 'function') {
    res.json({ token: req.csrfToken() });
  } else {
    res.json({ token: 'csrf-not-available' });
  }
});

function ensureConversationAccess(conversationId, userId) {
  const conversation = selectConversationById.get(conversationId);
  if (!conversation) {
    const error = new Error('Conversation not found');
    error.statusCode = 404;
    throw error;
  }
  const participant = selectParticipant.get(conversationId, userId);
  if (!participant) {
    const error = new Error('Forbidden');
    error.statusCode = 403;
    throw error;
  }
  return conversation;
}

function getConversationRoom(conversationId) {
  return `conversation:${conversationId}`;
}

function getUserRoom(userId) {
  return `user:${userId}`;
}

function broadcastConversationUpdate(conversationId) {
  const conversation = selectConversationById.get(conversationId);
  if (!conversation) return;
  const participants = selectParticipants.all(conversationId);
  participants.forEach((participant) => {
    const sanitized = sanitizeUser(participant);
    io.to(getUserRoom(sanitized.id)).emit('conversation:upsert', {
      conversation: serializeConversation(conversation, sanitized.id)
    });
  });
}

function getServerRoom(serverId) {
  return `server:${serverId}`;
}

function getChannelRoom(channelId) {
  return `channel:${channelId}`;
}

function broadcastServerUpdate(serverId) {
  const server = selectServerById.get(serverId);
  if (!server) return;
  const members = listServerMembers.all(serverId);
  members.forEach((member) => {
    io.to(getUserRoom(member.user_id)).emit('server:upsert', {
      server: serializeServerEntity(server, member.user_id)
    });
  });
}

function emitChannelMessage(message) {
  if (!message) return;
  io.to(getChannelRoom(message.channel_id)).emit('channel:message:new', {
    serverId: message.server_id,
    channelId: message.channel_id,
    message
  });
  listServerMembers.all(message.server_id).forEach((member) => {
    io.to(getUserRoom(member.user_id)).emit('channel:message:notify', {
      serverId: message.server_id,
      channelId: message.channel_id,
      message
    });
  });
}

function createMessage(conversationId, authorId, content, attachmentPayload = null, replyToMessageId = null) {
  const conversation = ensureConversationAccess(conversationId, authorId);
  const replyId = replyToMessageId ? Number(replyToMessageId) : null;
  if (replyId !== null && (!Number.isInteger(replyId) || !db.prepare('SELECT id FROM messages WHERE id = ? AND conversation_id = ?').get(replyId, conversationId))) {
    const error = new Error('Сообщение для ответа не найдено в этом диалоге.');
    error.statusCode = 400;
    throw error;
  }
  const trimmed = (content || '').trim();
  if (!trimmed && !attachmentPayload) {
    const error = new Error('Message must include text or attachment.');
    error.statusCode = 400;
    throw error;
  }

  const attachmentForClient = attachmentPayload ? attachmentPayload.public : null;
  const result = insertMessage.run(
    conversation.id,
    authorId,
    trimmed || null,
    attachmentForClient ? JSON.stringify(attachmentForClient) : null,
    replyId
  );
  const messageId = result.lastInsertRowid;
  if (attachmentPayload) {
    insertAttachmentRecord.run(
      attachmentForClient.id,
      messageId,
      conversation.id,
      attachmentForClient.name,
      attachmentForClient.mime,
      attachmentForClient.size,
      attachmentPayload.storagePath
    );
  }
  updateConversationTimestamp.run(conversation.id);
  const row = selectMessageWithAuthor.get(messageId);
  const message = serializeMessage(row);
  broadcastConversationUpdate(conversation.id);
  io.to(getConversationRoom(conversation.id)).emit('message:new', {
    conversationId: conversation.id,
    message
  });
  getConversationParticipants(conversation.id).forEach((participant) => {
    io.to(getUserRoom(participant.id)).emit('message:notify', {
      conversationId: conversation.id,
      message
    });
  });
  return message;
}

function createChannelMessage(serverId, channelId, authorId, content, attachmentPayload = null, replyToMessageId = null) {
  const { channel, permissions } = ensureChannelAccess(serverId, channelId, authorId);
  if (!hasPermission(permissions, PERMISSIONS.VIEW_CHANNEL | PERMISSIONS.SEND_MESSAGES)) {
    const error = new Error('Missing permission to send messages in this channel.');
    error.statusCode = 403;
    throw error;
  }
  if (channel.type !== 'text') {
    const error = new Error('Messages can only be sent to text channels.');
    error.statusCode = 400;
    throw error;
  }

  const replyId = replyToMessageId ? Number(replyToMessageId) : null;
  if (replyId !== null && (!Number.isInteger(replyId) || !db.prepare('SELECT id FROM server_messages WHERE id = ? AND server_id = ? AND channel_id = ?').get(replyId, serverId, channelId))) {
    const error = new Error('Сообщение для ответа не найдено в этом канале.');
    error.statusCode = 400;
    throw error;
  }
  const trimmed = (content || '').trim();
  if (!trimmed && !attachmentPayload) {
    const error = new Error('Message must include text or attachment.');
    error.statusCode = 400;
    throw error;
  }
  const attachmentForClient = attachmentPayload ? attachmentPayload.public : null;
  const result = insertServerMessage.run(
    channel.server_id,
    channel.id,
    authorId,
    trimmed || null,
    attachmentForClient ? JSON.stringify(attachmentForClient) : null,
    replyId
  );
  const messageId = result.lastInsertRowid;
  if (attachmentPayload) {
    insertServerAttachmentRecord.run(
      attachmentForClient.id,
      messageId,
      channel.server_id,
      channel.id,
      attachmentForClient.name,
      attachmentForClient.mime,
      attachmentForClient.size,
      attachmentPayload.storagePath
    );
  }
  const row = selectServerMessageWithAuthor.get(messageId);
  const message = serializeServerMessage(row);
  emitChannelMessage(message);
  return message;
}

function ensureFriends(userA, userB) {
  const existing = selectFriendshipBetween.get(userA, userB, userB, userA);
  return existing && existing.status === 'accepted';
}

function validatePasswordStrength(password, identifier = '') {
  const analysis = zxcvbn(password, identifier ? [identifier] : undefined);
  if (analysis.score < PASSWORD_MIN_SCORE) {
    const error = new Error('Password too weak. Use longer passphrases with symbols.');
    error.statusCode = 400;
    throw error;
  }
}

passport.serializeUser((user, done) => {
  done(null, user.id);
});

passport.deserializeUser((id, done) => {
  try {
    const user = selectUserById.get(id);
    done(null, sanitizeUser(user));
  } catch (error) {
    done(error);
  }
});

passport.use(
  new LocalStrategy(
    {
      usernameField: 'email',
      passwordField: 'password',
      passReqToCallback: true
    },
    (req, email, password, done) => {
      try {
        if (typeof email !== 'string' || typeof password !== 'string') {
          return done(null, false, { message: 'Неверный email или пароль.' });
        }
        const user = selectUserByEmail.get(email.toLowerCase());
        if (!user || !user.password_hash) {
          return done(null, false, { message: 'Invalid credentials' });
        }
        const isMatch = bcrypt.compareSync(password, user.password_hash);
        if (!isMatch) {
          return done(null, false, { message: 'Invalid credentials' });
        }

        if (user.twofa_enabled) {
          const token = req.body?.totp || req.body?.token;
          if (!token) {
            return done(null, false, {
              message: 'Two-factor code required.',
              twoFactorRequired: true
            });
          }
          const verified = speakeasy.totp.verify({
            secret: user.twofa_secret,
            encoding: 'base32',
            token,
            window: 1
          });
          if (!verified) {
            return done(null, false, {
              message: 'Invalid two-factor code.',
              twoFactorRequired: true
            });
          }
        }

        return done(null, sanitizeUser(user));
      } catch (error) {
        return done(error);
      }
    }
  )
);

const githubReady = Boolean(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET);

if (githubReady) {
  passport.use(
    new GitHubStrategy(
      {
        clientID: process.env.GITHUB_CLIENT_ID,
        clientSecret: process.env.GITHUB_CLIENT_SECRET,
        callbackURL: process.env.GITHUB_CALLBACK_URL || 'http://localhost:4000/api/auth/github/callback',
        scope: ['user:email']
      },
      (accessToken, refreshToken, profile, done) => {
        try {
          const existingAccount = selectOAuthAccount.get('github', profile.id);
          if (existingAccount) {
            const user = selectUserById.get(existingAccount.user_id);
            return done(null, sanitizeUser(user));
          }

          // Привязываем вход к существующему аккаунту только по ПОДТВЕРЖДЁННОМУ email GitHub.
          // Иначе можно добавить в GitHub чужой неподтверждённый email и войти в чужой аккаунт.
          const emails = Array.isArray(profile.emails) ? profile.emails : [];
          const verifiedEmail = (
            emails.find((item) => item?.verified === true && item?.primary) ||
            emails.find((item) => item?.verified === true)
          )?.value;
          const primaryEmail = verifiedEmail || `${profile.username || profile.id}@github.local`;

          let user = selectUserByEmail.get(primaryEmail.toLowerCase());
          if (user && !verifiedEmail) {
            // Совпадение найдено только по неподтверждённому/подставному адресу — не привязываем.
            return done(null, false, { message: 'GitHub account has no verified email.' });
          }
          if (!user) {
            const result = insertUser.run(
              primaryEmail.toLowerCase(),
              generateHandleFromEmail(primaryEmail),
              null,
              (profile.photos && profile.photos[0]?.value) || '',
              1,
              0,
              null
            );
            user = selectUserById.get(result.lastInsertRowid);
          }

          if (!user.profile_complete) {
            const desiredHandle = profile.username
              ? generateUniqueHandle(profile.username)
              : user.username;
            const preferredName = profile.displayName || profile.username || user.email.split('@')[0];
            markProfile.run(preferredName, desiredHandle, randomDiscriminator(), user.bio || '', user.avatar_color && user.avatar_color !== '#D97757' ? user.avatar_color : defaultAvatarColor(desiredHandle), Number.isInteger(user.avatar_preset) ? user.avatar_preset : 0, Number.isInteger(user.avatar_preset) ? user.avatar_preset : 0, preferredName, desiredHandle, user.id);
            user = selectUserById.get(user.id);
          }

          insertOAuthAccount.run(
            user.id,
            'github',
            profile.id,
            accessToken,
            refreshToken
          );

          return done(null, sanitizeUser(user));
        } catch (error) {
          return done(error);
        }
      }
    )
  );
}

app.post('/api/auth/password-strength', authLimiter, (req, res) => {
  const password = typeof req.body?.password === 'string' ? req.body.password.slice(0, 128) : '';
  const email = typeof req.body?.email === 'string' ? req.body.email.slice(0, 254) : '';
  if (!password) return res.status(400).json({ message: 'Введите пароль.' });
  const analysis = zxcvbn(password, email ? [email] : undefined);
  return res.json({ score: analysis.score, label: ['Слабый', 'Слабый', 'Средний', 'Хороший', 'Сильный'][analysis.score] });
});

app.post('/api/auth/register', (req, res) => {
  const { email, password } = req.body || {};

  if (!email || !password) {
    return res.status(400).json({ message: 'Введите адрес электронной почты и пароль.' });
  }
  if (typeof email !== 'string' || typeof password !== 'string') {
    return res.status(400).json({ message: 'Проверьте адрес электронной почты и пароль.' });
  }
  if (email.length > 254 || password.length > 128) {
    return res.status(400).json({ message: 'Email не должен превышать 254 символа, пароль — 128 символов.' });
  }
  const normalizedEmail = email.trim().toLowerCase();
  if (!isValidEmail(normalizedEmail)) {
    return res.status(400).json({ message: 'Введите корректный адрес электронной почты.' });
  }

  try {
    const existing = selectUserByEmail.get(normalizedEmail);
    if (existing) {
      return res.status(409).json({ message: 'Этот адрес электронной почты уже используется.' });
    }

    validatePasswordStrength(password, normalizedEmail);
    const passwordHash = bcrypt.hashSync(password, 12);
    const placeholderHandle = generateHandleFromEmail(normalizedEmail);
    const result = insertUser.run(
      normalizedEmail,
      placeholderHandle,
      passwordHash,
      '',
      0,
      0,
      null
    );
    db.prepare('UPDATE users SET avatar_color = ? WHERE id = ?').run(defaultAvatarColor(placeholderHandle), result.lastInsertRowid);
    const user = selectUserById.get(result.lastInsertRowid);
    const safeUser = sanitizeUser(user);

    req.session.regenerate((regenErr) => {
      if (regenErr) {
        return res.status(500).json({ message: 'Не удалось создать сессию. Повторите попытку.' });
      }
      req.session.cookie.maxAge = req.body?.remember === false ? null : 30 * 24 * 60 * 60 * 1000;
      req.login(safeUser, (err) => {
        if (err) {
          return res.status(500).json({ message: 'Login failed after registration.' });
        }
        res.status(201).json({ user: safeUser });
      });
    });
  } catch (error) {
    // Ошибки валидации (например, слабый пароль) несут statusCode и безопасны для показа;
    // внутренние ошибки не раскрываем.
    if (error.statusCode && error.statusCode < 500) {
      return res.status(error.statusCode).json({ message: error.message });
    }
    console.error('Registration failed:', error);
    res.status(500).json({ message: 'Registration failed.' });
  }
});

app.post('/api/auth/login', (req, res, next) => {
  passport.authenticate('local', (err, user, info) => {
    if (err) {
      return res.status(500).json({ message: 'Не удалось выполнить вход. Повторите попытку.' });
    }
    if (!user) {
      return res.status(401).json({
        message: info?.message || 'Неверный email или пароль.',
        twoFactorRequired: Boolean(info?.twoFactorRequired)
      });
    }
    req.session.regenerate((regenErr) => {
      if (regenErr) {
        return res.status(500).json({ message: 'Session initialization failed.' });
      }
      req.session.cookie.maxAge = req.body?.remember === false ? null : 30 * 24 * 60 * 60 * 1000;
      req.login(user, (loginErr) => {
        if (loginErr) {
          return res.status(500).json({ message: 'Login failed.' });
        }
        return res.json({ user });
      });
    });
  })(req, res, next);
});

app.post('/api/auth/2fa/initiate', ensureAuthenticated, async (req, res) => {
  if (req.user.twofa_enabled) {
    return res.status(400).json({ message: 'Two-factor authentication already enabled.' });
  }
  const secret = speakeasy.generateSecret({
    name: `Nexo (${req.user.email})`,
    length: 20
  });
  req.session.twofaSetup = {
    secret: secret.base32,
    otpauth: secret.otpauth_url
  };
  const qr = await QRCode.toDataURL(secret.otpauth_url);
  res.json({ otpauthUrl: secret.otpauth_url, qr });
});

app.post('/api/auth/2fa/enable', ensureAuthenticated, (req, res) => {
  const pending = req.session.twofaSetup;
  if (!pending) {
    return res.status(400).json({ message: 'No pending 2FA setup.' });
  }
  const token = req.body?.token;
  if (!token) {
    return res.status(400).json({ message: 'Two-factor code is required.' });
  }
  const verified = speakeasy.totp.verify({
    secret: pending.secret,
    encoding: 'base32',
    token,
    window: 1
  });
  if (!verified) {
    return res.status(400).json({ message: 'Invalid two-factor code.' });
  }
  updateTwoFactor.run(pending.secret, 1, req.user.id);
  delete req.session.twofaSetup;
  const updated = sanitizeUser(selectUserById.get(req.user.id));
  req.user = updated;
  res.json({ enabled: true, user: updated });
});

app.post('/api/auth/2fa/disable', ensureAuthenticated, (req, res) => {
  if (!req.user.twofa_enabled) {
    return res.status(400).json({ message: 'Two-factor authentication not enabled.' });
  }
  const token = req.body?.token;
  if (!token) {
    return res.status(400).json({ message: 'Two-factor code is required.' });
  }
  const fullUser = selectUserById.get(req.user.id);
  const verified = speakeasy.totp.verify({
    secret: fullUser.twofa_secret,
    encoding: 'base32',
    token,
    window: 1
  });
  if (!verified) {
    return res.status(400).json({ message: 'Invalid two-factor code.' });
  }
  updateTwoFactor.run(null, 0, req.user.id);
  const updated = sanitizeUser(selectUserById.get(req.user.id));
  req.user = updated;
  res.json({ disabled: true, user: updated });
});

app.post('/api/auth/password', ensureAuthenticated, (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ message: 'Current and new password are required.' });
  }
  const fullUser = selectUserById.get(req.user.id);
  const isMatch = bcrypt.compareSync(currentPassword, fullUser.password_hash);
  if (!isMatch) {
    return res.status(400).json({ message: 'Current password is incorrect.' });
  }
  validatePasswordStrength(newPassword, req.user.email);
  const newHash = bcrypt.hashSync(newPassword, 12);
  updatePasswordHash.run(newHash, req.user.id);
  res.json({ updated: true });
});

function checkHandleAvailability(req, res) {
  const rawUsername = typeof req.query.username === 'string' ? req.query.username.trim().toLowerCase() : '';
  if (!/^[a-z0-9](?:[a-z0-9._-]{1,22}[a-z0-9])$/.test(rawUsername)) {
    return res.json({ available: false, reason: 'Логин: 3–24 символа a–z, 0–9, точка, дефис или подчёркивание. Первый и последний символ — буква или цифра.' });
  }
  const existing = selectUserByUsername.get(rawUsername);
  const available = !existing || existing.id === req.user.id;
  return res.json({ available, reason: available ? 'Свободен' : 'Уже занят' });
}
app.get('/api/profile/check-handle', ensureAuthenticated, friendActionLimiter, checkHandleAvailability);
// Backward-compatible route for clients from 0.0.3.
app.get('/api/profile/username-availability', ensureAuthenticated, friendActionLimiter, checkHandleAvailability);

app.post('/api/profile', ensureAuthenticated, friendActionLimiter, (req, res) => {
  const rawName = typeof req.body?.displayName === 'string' ? req.body.displayName.trim() : '';
  const rawHandle = typeof req.body?.username === 'string' ? req.body.username.trim().toLowerCase() : '';
  const safeBio = typeof req.body?.bio === 'string' ? req.body.bio.trim().slice(0, 200) : '';
  const safeAvatarColor = typeof req.body?.avatarColor === 'string' && /^#[0-9a-fA-F]{6}$/.test(req.body.avatarColor)
    ? req.body.avatarColor : req.user.avatar_color || '#D97757';
  const currentHandle = String(req.user.username || '').toLowerCase();
  const handleChanged = rawHandle !== currentHandle;
  const nameChanged = rawName !== String(req.user.display_name || '');

  if (rawName.length < 2 || rawName.length > 32) {
    return res.status(400).json({ message: 'Имя должно содержать от 2 до 32 символов.' });
  }
  if (!/^[a-z0-9](?:[a-z0-9._-]{1,22}[a-z0-9])$/.test(rawHandle)) {
    return res.status(400).json({ message: 'Логин должен содержать от 3 до 24 символов: a–z, 0–9, точка, дефис или подчёркивание. Нельзя начинать или заканчивать спецсимволом.' });
  }

  if (handleChanged && req.user.profile_complete) {
    const lastChanged = req.user.username_changed_at ? Date.parse(req.user.username_changed_at + (String(req.user.username_changed_at).includes('Z') ? '' : 'Z')) : 0;
    if (lastChanged && Date.now() - lastChanged < 14 * 24 * 60 * 60 * 1000) {
      const remainingDays = Math.ceil((14 * 24 * 60 * 60 * 1000 - (Date.now() - lastChanged)) / (24 * 60 * 60 * 1000));
      return res.status(429).json({ message: `Логин можно менять раз в 14 дней. Повторите через ${remainingDays} дн.` });
    }
  }
  if (nameChanged && req.user.display_name_changed_at) {
    const lastNameChange = Date.parse(req.user.display_name_changed_at + (String(req.user.display_name_changed_at).includes('Z') ? '' : 'Z'));
    if (Number.isFinite(lastNameChange) && Date.now() - lastNameChange < 60 * 1000) {
      return res.status(429).json({ message: 'Отображаемое имя можно менять не чаще одного раза в минуту.' });
    }
  }
  const existingHandle = selectUserByUsername.get(rawHandle);
  if (existingHandle && existingHandle.id !== req.user.id) {
    return res.status(409).json({ message: 'Этот логин уже занят.' });
  }

  try {
    const stableDiscriminator = req.user.discriminator || randomDiscriminator();
    const requestedPreset = Number(req.body?.avatarPreset);
    const safeAvatarPreset = Number.isInteger(requestedPreset) && requestedPreset >= 0 && requestedPreset <= 11
      ? requestedPreset : Number(req.user.avatar_preset) || 0;
    markProfile.run(rawName, rawHandle, stableDiscriminator, safeBio, safeAvatarColor, safeAvatarPreset, safeAvatarPreset, rawName, rawHandle, req.user.id);
    const updated = sanitizeUser(selectUserById.get(req.user.id));
    req.user = updated;
    broadcastUserUpdate(updated);
    return res.json({ user: updated });
  } catch (error) {
    console.error('Profile update failed:', error);
    return res.status(500).json({ message: 'Не удалось сохранить профиль.' });
  }
});

app.post('/api/profile/avatar', ensureAuthenticated, friendActionLimiter, upload.single('avatar'), async (req, res) => {
  if (!req.file) return res.status(400).json({ message: 'Выберите изображение аватара.' });
  try {
    if (req.file.size > 2 * 1024 * 1024) {
      await removeFileSafe(req.file.path);
      return res.status(413).json({ message: 'Изображение должно быть не больше 2 МБ.' });
    }
    const detected = await fileTypeFromFile(req.file.path).catch(() => null);
    if (!detected || !['png', 'jpg', 'jpeg', 'webp'].includes(detected.ext)) {
      await removeFileSafe(req.file.path);
      return res.status(415).json({ message: 'Поддерживаются только PNG, JPG и WebP.' });
    }
    const avatarPath = path.join(avatarsDir, `user-${req.user.id}.webp`);
    await sharp(req.file.path).rotate().resize(256, 256, { fit: 'cover', position: 'attention' }).webp({ quality: 84 }).toFile(avatarPath);
    await removeFileSafe(req.file.path);
    db.prepare('UPDATE users SET avatar_url = ? WHERE id = ?').run(`/api/avatars/${req.user.id}?v=${Date.now()}`, req.user.id);
    const updated = sanitizeUser(selectUserById.get(req.user.id));
    req.user = updated;
    broadcastUserUpdate(updated);
    return res.json({ user: updated });
  } catch (error) {
    await removeFileSafe(req.file.path);
    console.error('Avatar upload failed:', error);
    return res.status(500).json({ message: 'Не удалось обработать изображение.' });
  }
});

app.delete('/api/profile/avatar', ensureAuthenticated, friendActionLimiter, async (req, res) => {
  try {
    await removeFileSafe(path.join(avatarsDir, `user-${req.user.id}.webp`));
    db.prepare("UPDATE users SET avatar_url = '' WHERE id = ?").run(req.user.id);
    const updated = sanitizeUser(selectUserById.get(req.user.id));
    req.user = updated;
    broadcastUserUpdate(updated);
    return res.json({ user: updated });
  } catch (error) {
    return res.status(500).json({ message: 'Не удалось удалить аватар.' });
  }
});

app.get('/api/avatars/:userId', ensureAuthenticated, async (req, res) => {
  const userId = Number(req.params.userId);
  if (!Number.isInteger(userId)) return res.status(400).end();
  const target = selectUserById.get(userId);
  if (!target?.avatar_url) return res.status(404).end();
  const avatarPath = path.join(avatarsDir, `user-${userId}.webp`);
  if (!fs.existsSync(avatarPath)) return res.status(404).end();
  res.setHeader('Cache-Control', 'private, max-age=300');
  return res.type('image/webp').sendFile(avatarPath);
});

app.put('/api/profile/status', ensureAuthenticated, friendActionLimiter, (req, res) => {
  const allowed = new Set(['online', 'idle', 'dnd', 'invisible']);
  const nextStatus = typeof req.body?.status === 'string' ? req.body.status : '';
  const customStatus = typeof req.body?.customStatus === 'string' ? req.body.customStatus.trim().slice(0, 60) : '';
  if (!allowed.has(nextStatus)) return res.status(400).json({ message: 'Недопустимый статус.' });
  db.prepare('UPDATE users SET status = ?, custom_status = ? WHERE id = ?').run(nextStatus, customStatus, req.user.id);
  const updated = sanitizeUser(selectUserById.get(req.user.id));
  req.user = updated;
  broadcastUserUpdate(updated);
  return res.json({ user: updated });
});

app.get('/api/profile/me', ensureAuthenticated, (req, res) => {
  res.json({ user: sanitizeUser(req.user) });
});

app.get('/api/settings/me', ensureAuthenticated, (req, res) => {
  const settings = getUserSettings(req.user.id);
  res.json({ settings });
});

app.put('/api/settings/me', ensureAuthenticated, (req, res) => {
  try {
    const next = updateUserSettingsRecord(req.user.id, req.body || {});
    res.json({ settings: next });
  } catch (error) {
    res.status(400).json({ message: error.message || 'Failed to update settings.' });
  }
});

app.get('/api/friends', ensureAuthenticated, (req, res) => {
  const rows = listFriendships.all(req.user.id, req.user.id);
  const hydrated = rows.map((row) => hydrateFriendship(row, req.user.id)).filter(Boolean);

  const response = {
    incoming: hydrated.filter((item) => item.status === 'pending' && item.direction === 'incoming'),
    outgoing: hydrated.filter((item) => item.status === 'pending' && item.direction === 'outgoing'),
    friends: hydrated.filter((item) => item.status === 'accepted')
  };

  res.json(response);
});

app.post('/api/friends/request', ensureAuthenticated, friendActionLimiter, (req, res) => {
  const { username } = req.body;
  const targetHandle = normalizeHandle(username);

  if (!targetHandle) {
    return res.status(400).json({ message: 'Username is required.' });
  }

  const target = selectUserByUsername.get(targetHandle);
  if (!target) {
    return res.status(404).json({ message: 'User not found.' });
  }

  if (target.id === req.user.id) {
    return res.status(400).json({ message: 'Cannot add yourself.' });
  }

  const existing = selectFriendshipBetween.get(req.user.id, target.id, target.id, req.user.id);
  if (existing) {
    if (existing.status === 'accepted') {
      return res.status(409).json({ message: 'You are already friends.' });
    }
    return res.status(409).json({ message: 'Friend request already exists.' });
  }

  try {
    const result = insertFriendRequest.run(req.user.id, target.id, 'pending');
    const created = hydrateFriendship(selectFriendshipById.get(result.lastInsertRowid), req.user.id);
    return res.status(201).json({ request: created });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to send friend request.', error: error.message });
  }
});

app.post('/api/friends/respond', ensureAuthenticated, friendActionLimiter, (req, res) => {
  const { requestId, action } = req.body;
  const request = selectFriendshipById.get(requestId);

  if (!request || request.addressee_id !== req.user.id) {
    return res.status(404).json({ message: 'Friend request not found.' });
  }

  if (action === 'accept') {
    updateFriendStatus.run('accepted', requestId);
    const updated = hydrateFriendship(selectFriendshipById.get(requestId), req.user.id);
    return res.json({ friend: updated });
  }

  if (action === 'decline') {
    deleteFriendship.run(requestId);
    return res.json({ declined: true });
  }

  return res.status(400).json({ message: 'Unsupported action.' });
});

app.get('/api/conversations', ensureAuthenticated, (req, res) => {
  const rows = listConversationsForUser.all(req.user.id);
  const conversations = rows
    .map((conversation) => serializeConversation(conversation, req.user.id))
    .filter(Boolean);
  res.json({ conversations });
});

app.post('/api/conversations/dm', ensureAuthenticated, (req, res) => {
  const { username } = req.body;
  const normalizedHandle = normalizeHandle(username);
  if (!normalizedHandle) {
    return res.status(400).json({ message: 'Username is required.' });
  }
  const target = selectUserByUsername.get(normalizedHandle);
  if (!target) {
    return res.status(404).json({ message: 'User not found.' });
  }
  if (target.id === req.user.id) {
    return res.status(400).json({ message: 'Cannot create DM with yourself.' });
  }
  if (!ensureFriends(req.user.id, target.id)) {
    return res.status(403).json({ message: 'Only friends can start DMs.' });
  }

  let conversation = selectConversationBetween.get(req.user.id, target.id);
  if (!conversation) {
    const result = insertConversation.run('dm', null);
    insertParticipant.run(result.lastInsertRowid, req.user.id, 'owner');
    insertParticipant.run(result.lastInsertRowid, target.id, 'member');
    conversation = selectConversationById.get(result.lastInsertRowid);
    broadcastConversationUpdate(conversation.id);
  }

  const payload = serializeConversation(conversation, req.user.id);
  res.status(201).json({ conversation: payload });
});

app.get('/api/servers', ensureAuthenticated, (req, res) => {
  const rows = listServersForUser.all(req.user.id);
  const servers = rows.map((server) => serializeServerEntity(server, req.user.id)).filter(Boolean);
  res.json({ servers });
});

app.post('/api/servers', ensureAuthenticated, (req, res) => {
  const { name, description } = req.body || {};
  const trimmedName = (name || '').trim();
  if (trimmedName.length < 3 || trimmedName.length > 48) {
    return res.status(400).json({ message: 'Server name must be between 3 and 48 characters.' });
  }
  const safeDescription = (description || '').trim().slice(0, 240);
  try {
    const result = insertServer.run(req.user.id, trimmedName, '', safeDescription);
    insertServerMember.run(result.lastInsertRowid, req.user.id, 'owner', '');
    insertRole.run(result.lastInsertRowid, 'Owner', '#f97316', 1000, PERMISSIONS.ADMIN, 0);
    insertRole.run(
      result.lastInsertRowid,
      'Community',
      '#a78bfa',
      0,
      PERMISSIONS.VIEW_CHANNEL | PERMISSIONS.SEND_MESSAGES | PERMISSIONS.CONNECT_VOICE | PERMISSIONS.SPEAK_VOICE | PERMISSIONS.STREAM,
      1
    );
    insertChannel.run(result.lastInsertRowid, 'text', 'general', 'Welcome to your server', 0);
    const server = selectServerById.get(result.lastInsertRowid);
    const payload = serializeServerEntity(server, req.user.id);
    broadcastServerUpdate(server.id);
    return res.status(201).json({ server: payload });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to create server.', error: error.message });
  }
});

app.put('/api/servers/:serverId/profile', ensureAuthenticated, (req, res) => {
  const serverId = Number(req.params.serverId);
  if (!Number.isFinite(serverId)) {
    return res.status(400).json({ message: 'Invalid server id.' });
  }
  const { name, description, icon } = req.body || {};
  if (name && (name.length < 3 || name.length > 48)) {
    return res.status(400).json({ message: 'Server name must be between 3 and 48 characters.' });
  }
  try {
    ensureServerOwnership(serverId, req.user.id);
    const existing = selectServerById.get(serverId);
    updateServerProfile.run(
      name ? name.trim() : existing.name,
      description ? description.trim().slice(0, 240) : existing.description,
      icon ? icon.trim().slice(0, 512) : existing.icon,
      serverId
    );
    broadcastServerUpdate(serverId);
    const server = selectServerById.get(serverId);
    return res.json({ server: serializeServerEntity(server, req.user.id) });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ message: error.message });
  }
});

app.get('/api/servers/:serverId/members', ensureAuthenticated, (req, res) => {
  const serverId = Number(req.params.serverId);
  if (!Number.isFinite(serverId)) {
    return res.status(400).json({ message: 'Invalid server id.' });
  }
  try {
    ensureServerMembership(serverId, req.user.id);
    const members = listServerMembersSerialized(serverId);
    return res.json({ members });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ message: error.message });
  }
});

app.post('/api/servers/:serverId/members/:memberId/roles', ensureAuthenticated, (req, res) => {
  const serverId = Number(req.params.serverId);
  const memberId = Number(req.params.memberId);
  if (!Number.isFinite(serverId) || !Number.isFinite(memberId)) {
    return res.status(400).json({ message: 'Invalid identifiers.' });
  }
  const { roleId, action } = req.body || {};
  if (!Number.isFinite(roleId) || !['assign', 'remove'].includes(action)) {
    return res.status(400).json({ message: 'Invalid payload.' });
  }
  const targetRole = selectRoleById.get(roleId);
  if (!targetRole || targetRole.server_id !== serverId) {
    return res.status(404).json({ message: 'Role not found.' });
  }
  const targetMember = selectServerMember.get(serverId, memberId);
  if (!targetMember) {
    return res.status(404).json({ message: 'Member not found.' });
  }
  try {
    ensurePermission(serverId, req.user.id, PERMISSIONS.MANAGE_ROLES);
    if (action === 'assign') {
      assignRoleToMember.run(serverId, roleId, memberId);
    } else {
      removeRoleFromMember.run(serverId, roleId, memberId);
    }
    broadcastServerUpdate(serverId);
    const members = listServerMembersSerialized(serverId);
    return res.json({ members });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ message: error.message });
  }
});

app.get('/api/servers/:serverId', ensureAuthenticated, (req, res) => {
  const serverId = Number(req.params.serverId);
  if (!Number.isFinite(serverId)) {
    return res.status(400).json({ message: 'Invalid server id.' });
  }
  try {
    const { server } = ensureServerMembership(serverId, req.user.id);
    return res.json({ server: serializeServerEntity(server, req.user.id) });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ message: error.message });
  }
});

app.get('/api/servers/:serverId/channels', ensureAuthenticated, (req, res) => {
  const serverId = Number(req.params.serverId);
  if (!Number.isFinite(serverId)) {
    return res.status(400).json({ message: 'Invalid server id.' });
  }
  try {
    ensureServerMembership(serverId, req.user.id);
    const channels = listChannelsForServer.all(serverId).map(serializeChannel);
    return res.json({ channels });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ message: error.message });
  }
});

app.post('/api/servers/:serverId/leave', ensureAuthenticated, friendActionLimiter, (req, res) => {
  const serverId = Number(req.params.serverId);
  if (!Number.isInteger(serverId)) return res.status(400).json({ message: 'Некорректный идентификатор пространства.' });
  const server = selectServerById.get(serverId);
  if (!server || !selectServerMember.get(serverId, req.user.id)) {
    return res.status(404).json({ message: 'Вы не состоите в этом пространстве.' });
  }
  if (server.owner_id === req.user.id) {
    return res.status(400).json({ message: 'Владелец не может покинуть своё пространство. Передайте владение или удалите его в будущем.' });
  }
  try {
    const leaveTransaction = db.transaction(() => {
      db.prepare('DELETE FROM voice_sessions WHERE server_id = ? AND user_id = ?').run(serverId, req.user.id);
      db.prepare('DELETE FROM server_member_roles WHERE server_id = ? AND user_id = ?').run(serverId, req.user.id);
      db.prepare('DELETE FROM server_members WHERE server_id = ? AND user_id = ?').run(serverId, req.user.id);
    });
    leaveTransaction();
    io.to(getUserRoom(req.user.id)).emit('server:leave', { serverId });
    broadcastServerUpdate(serverId);
    return res.json({ left: true, serverId });
  } catch (error) {
    console.error('Leave server failed:', error);
    return res.status(500).json({ message: 'Не удалось покинуть пространство.' });
  }
});

app.post('/api/servers/:serverId/channels', ensureAuthenticated, (req, res) => {
  const serverId = Number(req.params.serverId);
  if (!Number.isFinite(serverId)) {
    return res.status(400).json({ message: 'Invalid server id.' });
  }
  const { name, type = 'text', topic = '' } = req.body || {};
  const normalizedType = ['text', 'voice'].includes(type) ? type : 'text';
  const trimmedName = (name || '').trim().toLowerCase().replace(/[^a-z0-9-_]/g, '-');
  if (trimmedName.length < 3 || trimmedName.length > 32) {
    return res.status(400).json({ message: 'Channel name must be 3-32 characters.' });
  }
  try {
    ensureServerOwnership(serverId, req.user.id);
    const existingCount = listChannelsForServer.all(serverId).length;
    const created = insertChannel.run(serverId, normalizedType, trimmedName, topic.slice(0, 240), existingCount);
    const requestedLimit = Number(req.body?.userLimit);
    const userLimit = Number.isInteger(requestedLimit) ? Math.min(8, Math.max(2, requestedLimit)) : 8;
    if (normalizedType === 'voice') db.prepare('UPDATE channels SET user_limit = ? WHERE id = ?').run(userLimit, created.lastInsertRowid);
    broadcastServerUpdate(serverId);
    const server = selectServerById.get(serverId);
    return res.status(201).json({ server: serializeServerEntity(server, req.user.id) });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ message: error.message });
  }
});

app.delete('/api/servers/:serverId/channels/:channelId', ensureAuthenticated, friendActionLimiter, async (req, res) => {
  const serverId = Number(req.params.serverId);
  const channelId = Number(req.params.channelId);
  if (!Number.isInteger(serverId) || !Number.isInteger(channelId)) {
    return res.status(400).json({ message: 'Некорректный идентификатор канала.' });
  }
  const channel = selectChannelById.get(channelId);
  if (!channel || channel.server_id !== serverId) return res.status(404).json({ message: 'Канал не найден.' });
  try { ensureServerOwnership(serverId, req.user.id); }
  catch (error) { return res.status(error.statusCode || 500).json({ message: error.message }); }
  const attachments = db.prepare('SELECT path FROM server_attachments WHERE channel_id = ?').all(channelId);
  try {
    db.transaction(() => {
      db.prepare("DELETE FROM message_reactions WHERE scope = 'channel' AND message_id IN (SELECT id FROM server_messages WHERE channel_id = ?)").run(channelId);
      db.prepare("DELETE FROM message_pins WHERE scope = 'channel' AND channel_id = ?").run(channelId);
      db.prepare('DELETE FROM server_attachments WHERE channel_id = ?').run(channelId);
      db.prepare('DELETE FROM server_messages WHERE channel_id = ?').run(channelId);
      db.prepare('DELETE FROM channel_read_states WHERE channel_id = ?').run(channelId);
      db.prepare('DELETE FROM voice_sessions WHERE channel_id = ?').run(channelId);
      db.prepare('DELETE FROM channel_permission_overrides WHERE channel_id = ?').run(channelId);
      db.prepare('DELETE FROM channels WHERE id = ? AND server_id = ?').run(channelId, serverId);
    })();
    await Promise.all(attachments.map((attachment) => removeFileSafe(path.join(uploadsDir, attachment.path))));
    io.to(getChannelRoom(channelId)).emit('channel:deleted', { serverId, channelId });
    broadcastServerUpdate(serverId);
    return res.json({ deleted: true, channelId });
  } catch (error) {
    console.error('Channel deletion failed:', error);
    return res.status(500).json({ message: 'Не удалось удалить канал.' });
  }
});

app.put('/api/servers/:serverId/channels/:channelId', ensureAuthenticated, (req, res) => {
  const serverId = Number(req.params.serverId);
  const channelId = Number(req.params.channelId);
  if (!Number.isFinite(serverId) || !Number.isFinite(channelId)) {
    return res.status(400).json({ message: 'Invalid identifiers.' });
  }
  const channel = selectChannelById.get(channelId);
  if (!channel || channel.server_id !== serverId) {
    return res.status(404).json({ message: 'Channel not found.' });
  }
  try {
    ensureServerOwnership(serverId, req.user.id);
    const payload = req.body || {};
    const slowMode = Math.max(0, Math.min(21600, Number(payload.slow_mode_seconds) || 0));
    const isNsfw = payload.is_nsfw ? 1 : 0;
    const bitrate = channel.type === 'voice' ? Math.max(8000, Math.min(384000, Number(payload.bitrate) || channel.bitrate || 64000)) : channel.bitrate;
    const userLimit =
      channel.type === 'voice' ? Math.max(0, Math.min(99, Number(payload.user_limit) || channel.user_limit || 0)) : channel.user_limit;
    const soundscape = (payload.soundscape || channel.soundscape || '').slice(0, 120);
    const topic = payload.topic !== undefined ? String(payload.topic).slice(0, 256) : channel.topic;
    let name = channel.name;
    if (payload.name !== undefined) {
      name = String(payload.name).trim().toLowerCase().replace(/[^a-z0-9-_]/g, '-');
      if (name.length < 3 || name.length > 32) return res.status(400).json({ message: 'Имя канала должно содержать от 3 до 32 символов (латиница, цифры и дефис).' });
    }
    const update = db.prepare(`
      UPDATE channels
      SET name = ?, topic = ?, slow_mode_seconds = ?, is_nsfw = ?, bitrate = ?, user_limit = ?, soundscape = ?
      WHERE id = ?
    `);
    update.run(name, topic, slowMode, isNsfw, bitrate, userLimit, soundscape, channelId);
    broadcastServerUpdate(serverId);
    const updated = selectChannelById.get(channelId);
    return res.json({ channel: serializeChannel(updated) });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ message: error.message });
  }
});

app.get('/api/servers/:serverId/settings', ensureAuthenticated, (req, res) => {
  const serverId = Number(req.params.serverId);
  if (!Number.isFinite(serverId)) {
    return res.status(400).json({ message: 'Invalid server id.' });
  }
  try {
    ensureServerMembership(serverId, req.user.id);
    return res.json({ settings: getServerSettings(serverId) });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ message: error.message });
  }
});

app.put('/api/servers/:serverId/settings', ensureAuthenticated, (req, res) => {
  const serverId = Number(req.params.serverId);
  if (!Number.isFinite(serverId)) {
    return res.status(400).json({ message: 'Invalid server id.' });
  }
  try {
    ensureServerOwnership(serverId, req.user.id);
    const settings = updateServerSettingsRecord(serverId, req.body || {});
    return res.json({ settings });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ message: error.message });
  }
});

app.get('/api/servers/:serverId/channels/:channelId/messages', ensureAuthenticated, (req, res) => {
  const serverId = Number(req.params.serverId);
  const channelId = Number(req.params.channelId);
  if (!Number.isFinite(serverId) || !Number.isFinite(channelId)) {
    return res.status(400).json({ message: 'Invalid identifiers.' });
  }
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const offset = Number(req.query.offset) || 0;
  try {
    ensureChannelAccess(serverId, channelId, req.user.id);
    const rows = listChannelMessages.all(channelId, limit, offset);
    const messages = rows.map(serializeServerMessage).reverse();
    return res.json({ messages });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ message: error.message });
  }
});

app.post('/api/servers/:serverId/channels/:channelId/read', ensureAuthenticated, messageLimiter, (req, res) => {
  const serverId = Number(req.params.serverId);
  const channelId = Number(req.params.channelId);
  const messageId = Number(req.body?.messageId);
  if (![serverId, channelId, messageId].every(Number.isInteger) || messageId < 0) {
    return res.status(400).json({ message: 'Некорректная отметка прочтения.' });
  }
  try {
    const { permissions } = ensureChannelAccess(serverId, channelId, req.user.id);
    if (!hasPermission(permissions, PERMISSIONS.VIEW_CHANNEL)) return res.status(403).json({ message: 'Нет доступа к этому каналу.' });
    if (messageId > 0) {
      const message = db.prepare('SELECT id FROM server_messages WHERE id = ? AND server_id = ? AND channel_id = ?').get(messageId, serverId, channelId);
      if (!message) return res.status(404).json({ message: 'Сообщение не найдено в этом канале.' });
    }
    const previousReadMessageId = Number(selectChannelReadState.get(channelId, req.user.id)?.last_read_message_id || 0);
    const lastReadMessageId = Math.max(previousReadMessageId, messageId);
    if (lastReadMessageId > previousReadMessageId) {
      upsertChannelReadState.run(channelId, req.user.id, lastReadMessageId);
      io.to(getChannelRoom(channelId)).emit('channel:read:update', {
        serverId, channelId, userId: req.user.id, previousReadMessageId, lastReadMessageId
      });
    }
    return res.json({ serverId, channelId, userId: req.user.id, previousReadMessageId, lastReadMessageId });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ message: error.message || 'Не удалось отметить сообщения прочитанными.' });
  }
});

app.get('/api/servers/:serverId/channels/:channelId/pins', ensureAuthenticated, (req, res) => {
  const serverId = Number(req.params.serverId);
  const channelId = Number(req.params.channelId);
  if (![serverId, channelId].every(Number.isInteger)) return res.status(400).json({ message: 'Некорректный канал.' });
  try {
    const { permissions } = ensureChannelAccess(serverId, channelId, req.user.id);
    if (!hasPermission(permissions, PERMISSIONS.VIEW_CHANNEL)) return res.status(403).json({ message: 'Нет доступа к этому каналу.' });
    const pins = listChannelPins.all(channelId)
      .map(({ message_id }) => serializeServerMessage(selectServerMessageWithAuthor.get(message_id)))
      .filter(Boolean);
    return res.json({ pins });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ message: error.message });
  }
});

app.post('/api/servers/:serverId/channels/:channelId/messages/:messageId/pin', ensureAuthenticated, messageLimiter, (req, res) => {
  const serverId = Number(req.params.serverId);
  const channelId = Number(req.params.channelId);
  const messageId = Number(req.params.messageId);
  const action = req.body?.action;
  if (![serverId, channelId, messageId].every(Number.isInteger) || !['pin', 'unpin'].includes(action)) {
    return res.status(400).json({ message: 'Некорректное действие закрепления.' });
  }
  try {
    const { permissions } = ensureChannelAccess(serverId, channelId, req.user.id);
    if (!hasPermission(permissions, PERMISSIONS.VIEW_CHANNEL | PERMISSIONS.MANAGE_MESSAGES)) {
      return res.status(403).json({ message: 'Для закрепления сообщений требуется право «Управление сообщениями».' });
    }
    const message = db.prepare('SELECT id FROM server_messages WHERE id = ? AND server_id = ? AND channel_id = ?').get(messageId, serverId, channelId);
    if (!message) return res.status(404).json({ message: 'Сообщение не найдено.' });
    if (action === 'pin') insertMessagePin.run('channel', messageId, null, serverId, channelId, req.user.id);
    else deleteMessagePin.run('channel', messageId);
    const pin = getMessagePin('channel', messageId);
    io.to(getChannelRoom(channelId)).emit('channel:pin:update', { channelId, messageId, pin });
    return res.json({ messageId, pin });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ message: error.message || 'Не удалось закрепить сообщение.' });
  }
});

app.post('/api/servers/:serverId/channels/:channelId/messages/:messageId/reactions', ensureAuthenticated, messageLimiter, (req, res) => {
  const serverId = Number(req.params.serverId);
  const channelId = Number(req.params.channelId);
  const messageId = Number(req.params.messageId);
  const emoji = typeof req.body?.emoji === 'string' ? req.body.emoji : '';
  const allowed = new Set(['👍', '❤️', '😂', '😮', '😢', '🔥', '🎉', '👀']);
  if (![serverId, channelId, messageId].every(Number.isInteger) || !allowed.has(emoji)) {
    return res.status(400).json({ message: 'Некорректная реакция.' });
  }
  try {
    const { permissions } = ensureChannelAccess(serverId, channelId, req.user.id);
    if (!hasPermission(permissions, PERMISSIONS.VIEW_CHANNEL)) return res.status(403).json({ message: 'Нет доступа к этому каналу.' });
    const message = db.prepare('SELECT id FROM server_messages WHERE id = ? AND server_id = ? AND channel_id = ?')
      .get(messageId, serverId, channelId);
    if (!message) return res.status(404).json({ message: 'Сообщение не найдено.' });
    const existing = db.prepare('SELECT id FROM message_reactions WHERE scope = ? AND message_id = ? AND user_id = ? AND emoji = ?')
      .get('channel', messageId, req.user.id, emoji);
    if (existing) deleteMessageReaction.run('channel', messageId, req.user.id, emoji);
    else insertMessageReaction.run('channel', messageId, req.user.id, emoji);
    const reactions = getMessageReactions('channel', messageId);
    io.to(getChannelRoom(channelId)).emit('channel:reactions:update', { channelId, messageId, reactions });
    return res.json({ messageId, reactions });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ message: error.message || 'Не удалось добавить реакцию.' });
  }
});

app.patch('/api/servers/:serverId/channels/:channelId/messages/:messageId', ensureAuthenticated, messageLimiter, (req, res) => {
  const serverId = Number(req.params.serverId);
  const channelId = Number(req.params.channelId);
  const messageId = Number(req.params.messageId);
  const content = typeof req.body?.content === 'string' ? req.body.content.trim() : '';
  if (!Number.isInteger(serverId) || !Number.isInteger(channelId) || !Number.isInteger(messageId) || !content || content.length > 4000) {
    return res.status(400).json({ message: 'Сообщение должно содержать от 1 до 4000 символов.' });
  }
  try {
    ensureChannelAccess(serverId, channelId, req.user.id);
    const existing = db.prepare('SELECT id, author_id FROM server_messages WHERE id = ? AND server_id = ? AND channel_id = ?').get(messageId, serverId, channelId);
    if (!existing) return res.status(404).json({ message: 'Сообщение не найдено.' });
    if (existing.author_id !== req.user.id) return res.status(403).json({ message: 'Можно редактировать только свои сообщения.' });
    db.prepare('UPDATE server_messages SET content = ?, edited_at = CURRENT_TIMESTAMP WHERE id = ? AND server_id = ? AND channel_id = ?').run(content, messageId, serverId, channelId);
    const row = db.prepare(`
      SELECT sm.*, u.username, u.display_name, u.avatar_url, u.avatar_color
      FROM server_messages sm JOIN users u ON u.id = sm.author_id
      WHERE sm.id = ?
    `).get(messageId);
    const message = serializeServerMessage(row);
    io.to(getChannelRoom(channelId)).emit('server:message:update', { serverId, channelId, message });
    return res.json({ message });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ message: error.message || 'Не удалось изменить сообщение.' });
  }
});

app.post(
  '/api/servers/:serverId/channels/:channelId/messages',
  ensureAuthenticated,
  messageLimiter,
  upload.single('attachment'),
  async (req, res) => {
    const serverId = Number(req.params.serverId);
    const channelId = Number(req.params.channelId);
    if (!Number.isFinite(serverId) || !Number.isFinite(channelId)) {
      if (req.file) await removeFileSafe(req.file.path);
      return res.status(400).json({ message: 'Invalid identifiers.' });
    }

    let attachmentPayload = null;
    if (req.file) {
      try {
        attachmentPayload = await processServerAttachment(req.file, serverId, channelId);
      } catch (error) {
        return res.status(error.statusCode || 400).json({ message: error.message });
      }
    }

    try {
      const message = createChannelMessage(
        serverId,
        channelId,
        req.user.id,
        req.body.content,
        attachmentPayload,
        req.body.replyToMessageId
      );
      return res.status(201).json({ message });
    } catch (error) {
      if (attachmentPayload) {
        await removeFileSafe(path.join(uploadsDir, attachmentPayload.storagePath));
      } else if (req.file) {
        await removeFileSafe(req.file.path);
      }
      return res.status(error.statusCode || 500).json({ message: error.message });
    }
  }
);

app.post('/api/servers/:serverId/channels/:channelId/permissions', ensureAuthenticated, (req, res) => {
  const serverId = Number(req.params.serverId);
  const channelId = Number(req.params.channelId);
  if (!Number.isFinite(serverId) || !Number.isFinite(channelId)) {
    return res.status(400).json({ message: 'Invalid identifiers.' });
  }
  const { targetType, targetId, allow = 0, deny = 0 } = req.body || {};
  if (!['role', 'member'].includes(targetType)) {
    return res.status(400).json({ message: 'Invalid target type.' });
  }
  if (!Number.isFinite(targetId)) {
    return res.status(400).json({ message: 'Invalid target id.' });
  }
  try {
    const { channel } = ensureChannelAccess(serverId, channelId, req.user.id);
    const permissions = computeBasePermissions(serverId, req.user.id);
    if (!hasPermission(permissions, PERMISSIONS.MANAGE_CHANNELS)) {
      const error = new Error('Missing permission to manage channel.');
      error.statusCode = 403;
      throw error;
    }
    if (targetType === 'role') {
      const role = selectRoleById.get(targetId);
      if (!role || role.server_id !== serverId) {
        return res.status(404).json({ message: 'Role not found.' });
      }
    } else {
      const member = selectServerMember.get(serverId, targetId);
      if (!member) {
        return res.status(404).json({ message: 'Member not found.' });
      }
    }
    upsertOverride.run(channel.id, targetType, targetId, allow, deny);
    return res.json({ success: true });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ message: error.message });
  }
});

app.delete('/api/servers/:serverId/channels/:channelId/permissions', ensureAuthenticated, (req, res) => {
  const serverId = Number(req.params.serverId);
  const channelId = Number(req.params.channelId);
  if (!Number.isFinite(serverId) || !Number.isFinite(channelId)) {
    return res.status(400).json({ message: 'Invalid identifiers.' });
  }
  const { targetType, targetId } = req.body || {};
  if (!['role', 'member'].includes(targetType)) {
    return res.status(400).json({ message: 'Invalid target type.' });
  }
  if (!Number.isFinite(targetId)) {
    return res.status(400).json({ message: 'Invalid target id.' });
  }
  try {
    const { channel } = ensureChannelAccess(serverId, channelId, req.user.id);
    const permissions = computeBasePermissions(serverId, req.user.id);
    if (!hasPermission(permissions, PERMISSIONS.MANAGE_CHANNELS)) {
      const error = new Error('Missing permission to manage channel.');
      error.statusCode = 403;
      throw error;
    }
    deleteOverride.run(channel.id, targetType, targetId);
    return res.json({ success: true });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ message: error.message });
  }
});

app.get(
  '/api/servers/:serverId/channels/:channelId/files/:attachmentId',
  ensureAuthenticated,
  (req, res) => {
    const serverId = Number(req.params.serverId);
    const channelId = Number(req.params.channelId);
    const attachmentId = req.params.attachmentId;
    if (!Number.isFinite(serverId) || !Number.isFinite(channelId) || !attachmentId) {
      return res.status(400).json({ message: 'Invalid parameters.' });
    }
    try {
      ensureChannelAccess(serverId, channelId, req.user.id);
    } catch (error) {
      return res.status(error.statusCode || 500).json({ message: error.message });
    }
    const attachment = selectServerAttachmentById.get(attachmentId);
    if (
      !attachment ||
      attachment.server_id !== serverId ||
      attachment.channel_id !== channelId
    ) {
      return res.status(404).json({ message: 'Attachment not found.' });
    }
    const absolutePath = path.join(uploadsDir, attachment.path);
    if (!absolutePath.startsWith(uploadsDir) || !fs.existsSync(absolutePath)) {
      return res.status(404).json({ message: 'File missing.' });
    }
    res.setHeader('Content-Type', attachment.mime);
    res.setHeader('Content-Disposition', `inline; filename="${attachment.name.replace(/"/g, '')}"`);
    return res.sendFile(absolutePath);
  }
);

app.get('/api/servers/:serverId/channels/:channelId/voice', ensureAuthenticated, (req, res) => {
  const serverId = Number(req.params.serverId);
  const channelId = Number(req.params.channelId);
  if (!Number.isFinite(serverId) || !Number.isFinite(channelId)) {
    return res.status(400).json({ message: 'Invalid identifiers.' });
  }
  try {
    const { channel, permissions } = ensureChannelAccess(serverId, channelId, req.user.id);
    if (channel.type !== 'voice') {
      return res.status(400).json({ message: 'Channel is not voice.' });
    }
    if (!hasPermission(permissions, PERMISSIONS.VIEW_CHANNEL)) {
      return res.status(403).json({ message: 'Missing permission to view this voice channel.' });
    }
    return res.json({
      participants: listVoiceParticipants(channelId),
      canConnect: hasPermission(permissions, PERMISSIONS.VIEW_CHANNEL | PERMISSIONS.CONNECT_VOICE),
      canSpeak: hasPermission(permissions, PERMISSIONS.SPEAK_VOICE),
      canStream: hasPermission(permissions, PERMISSIONS.STREAM)
    });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ message: error.message });
  }
});

app.post('/api/servers/:serverId/channels/:channelId/voice/join', ensureAuthenticated, (req, res) => {
  const serverId = Number(req.params.serverId);
  const channelId = Number(req.params.channelId);
  if (!Number.isFinite(serverId) || !Number.isFinite(channelId)) {
    return res.status(400).json({ message: 'Invalid identifiers.' });
  }
  try {
    const { channel, permissions } = ensureChannelAccess(serverId, channelId, req.user.id);
    if (channel.type !== 'voice') {
      return res.status(400).json({ message: 'Channel is not voice.' });
    }
    if (!hasPermission(permissions, PERMISSIONS.CONNECT_VOICE)) {
      return res.status(403).json({ message: 'Missing permission to connect to this channel.' });
    }
    const currentSession = db.prepare('SELECT channel_id FROM voice_sessions WHERE user_id = ?').get(req.user.id);
    if (currentSession && currentSession.channel_id !== channelId) {
      return res.status(409).json({ message: 'Вы уже подключены к другому голосовому каналу. Сначала выйдите из него.' });
    }
    const participantCount = db.prepare('SELECT COUNT(*) AS count FROM voice_sessions WHERE channel_id = ?').get(channelId).count;
    const userLimit = Math.max(1, Number(channel.user_limit) || 8);
    if (!currentSession && participantCount >= userLimit) {
      return res.status(409).json({ message: 'В голосовом канале нет свободных мест.' });
    }
    const canSpeak = hasPermission(permissions, PERMISSIONS.SPEAK_VOICE);
    const muted = !canSpeak || Boolean(req.body?.muted);
    upsertVoiceSession.run(serverId, channelId, req.user.id, muted ? 1 : 0, req.body?.deafened ? 1 : 0);
    broadcastVoiceState(channelId);
    return res.json({ participants: listVoiceParticipants(channelId), canSpeak });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ message: error.message });
  }
});

app.patch('/api/servers/:serverId/channels/:channelId/voice/state', ensureAuthenticated, (req, res) => {
  const serverId = Number(req.params.serverId);
  const channelId = Number(req.params.channelId);
  if (!Number.isInteger(serverId) || !Number.isInteger(channelId)) return res.status(400).json({ message: 'Некорректный голосовой канал.' });
  try {
    const { channel, permissions } = ensureChannelAccess(serverId, channelId, req.user.id);
    if (channel.type !== 'voice') return res.status(400).json({ message: 'Канал не является голосовым.' });
    const session = db.prepare('SELECT id FROM voice_sessions WHERE channel_id = ? AND user_id = ?').get(channelId, req.user.id);
    if (!session) return res.status(409).json({ message: 'Вы не подключены к этому голосовому каналу.' });
    const requestedMuted = Boolean(req.body?.muted);
    if (!requestedMuted && !hasPermission(permissions, PERMISSIONS.SPEAK_VOICE)) {
      return res.status(403).json({ message: 'У вас нет права говорить в этом канале.' });
    }
    db.prepare('UPDATE voice_sessions SET muted = ?, deafened = ? WHERE channel_id = ? AND user_id = ?')
      .run(requestedMuted ? 1 : 0, req.body?.deafened ? 1 : 0, channelId, req.user.id);
    broadcastVoiceState(channelId);
    return res.json({ participants: listVoiceParticipants(channelId) });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ message: error.message });
  }
});

app.post('/api/servers/:serverId/channels/:channelId/voice/leave', ensureAuthenticated, (req, res) => {
  const serverId = Number(req.params.serverId);
  const channelId = Number(req.params.channelId);
  if (!Number.isFinite(serverId) || !Number.isFinite(channelId)) {
    return res.status(400).json({ message: 'Invalid identifiers.' });
  }
  try {
    const { channel } = ensureChannelAccess(serverId, channelId, req.user.id);
    if (channel.type !== 'voice') {
      return res.status(400).json({ message: 'Channel is not voice.' });
    }
    deleteVoiceSession.run(channelId, req.user.id);
    io.to(getChannelRoom(channelId)).emit('voice:left', { channelId, userId: req.user.id });
    broadcastVoiceState(channelId);
    return res.json({ participants: listVoiceParticipants(channelId) });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ message: error.message });
  }
});

app.get('/api/premium/plans', ensureAuthenticated, (_req, res) => {
  const plans = selectPremiumPlans.all().map((plan) => ({
    id: plan.id,
    slug: plan.slug,
    name: plan.name,
    description: plan.description,
    price_cents: plan.price_cents,
    currency: plan.currency,
    perks: normalizeBadges(plan.perks)
  }));
  res.json({ brand: PREMIUM_BRAND, plans });
});

app.get('/api/premium/status', ensureAuthenticated, (req, res) => {
  const active = selectActiveSubscription.get(req.user.id);
  res.json({
    active: Boolean(active),
    plan: active ? { id: active.plan_id, name: active.plan_name } : null,
    renews_at: active ? active.renews_at : null
  });
});

app.post('/api/premium/checkout', ensureAuthenticated, (req, res) => {
  const planId = Number(req.body?.planId);
  if (!Number.isFinite(planId)) {
    return res.status(400).json({ message: 'Invalid plan id.' });
  }
  const plan = selectPremiumPlanById.get(planId);
  if (!plan) {
    return res.status(404).json({ message: 'Plan not found.' });
  }
  const clientSecret = randomBytes(24).toString('hex');
  const paymentIntent = randomUUID();
  const result = insertPremiumTransaction.run(
    req.user.id,
    plan.id,
    plan.price_cents,
    plan.currency,
    'pending',
    paymentIntent,
    clientSecret
  );
  return res.status(201).json({
    transaction: {
      id: result.lastInsertRowid,
      plan_id: plan.id,
      payment_intent: paymentIntent,
      client_secret: clientSecret,
      amount_cents: plan.price_cents,
      currency: plan.currency
    }
  });
});

app.post('/api/premium/confirm', ensureAuthenticated, (req, res) => {
  const transactionId = Number(req.body?.transactionId);
  if (!Number.isFinite(transactionId)) {
    return res.status(400).json({ message: 'Invalid transaction id.' });
  }
  const record = selectPremiumTransactionById.get(transactionId);
  if (!record || record.user_id !== req.user.id) {
    return res.status(404).json({ message: 'Transaction not found.' });
  }
  if (record.status !== 'pending') {
    return res.status(409).json({ message: 'Transaction already processed.' });
  }
  updatePremiumTransactionStatus.run('succeeded', record.payment_intent, record.id);
  insertPremiumSubscription.run(
    req.user.id,
    record.plan_id,
    JSON.stringify({ transactionId: record.id, payment_intent: record.payment_intent })
  );
  const plan = selectPremiumPlanById.get(record.plan_id);
  return res.json({
    subscription: {
      plan: plan ? { id: plan.id, name: plan.name } : null,
      status: 'active'
    }
  });
});

app.get('/api/admin/premium/balance', (req, res) => {
  if (!PREMIUM_BALANCE_TOKEN || req.headers['x-admin-token'] !== PREMIUM_BALANCE_TOKEN) {
    return res.status(403).json({ message: 'Forbidden' });
  }
  const totals = selectPremiumBalance.get();
  res.json({
    brand: PREMIUM_BRAND,
    balance: {
      available_cents: totals?.available_cents || 0,
      pending_cents: totals?.pending_cents || 0,
      currency: 'USD'
    }
  });
});

app.delete('/api/servers/:serverId/channels/:channelId/messages/:messageId', ensureAuthenticated, messageLimiter, async (req, res) => {
  const serverId = Number(req.params.serverId);
  const channelId = Number(req.params.channelId);
  const messageId = Number(req.params.messageId);
  if (![serverId, channelId, messageId].every(Number.isInteger)) {
    return res.status(400).json({ message: 'Некорректный идентификатор сообщения.' });
  }
  try { ensureChannelAccess(serverId, channelId, req.user.id); }
  catch (error) { return res.status(error.statusCode || 500).json({ message: error.message }); }
  const message = db.prepare('SELECT id, author_id FROM server_messages WHERE id = ? AND server_id = ? AND channel_id = ?')
    .get(messageId, serverId, channelId);
  if (!message) return res.status(404).json({ message: 'Сообщение не найдено.' });
  if (message.author_id !== req.user.id) return res.status(403).json({ message: 'Можно удалять только свои сообщения.' });
  const attachments = db.prepare('SELECT path FROM server_attachments WHERE server_message_id = ?').all(messageId);
  try {
    db.transaction(() => {
      db.prepare("DELETE FROM message_reactions WHERE scope = 'channel' AND message_id = ?").run(messageId);
      db.prepare("DELETE FROM message_pins WHERE scope = 'channel' AND message_id = ?").run(messageId);
      db.prepare('DELETE FROM server_attachments WHERE server_message_id = ?').run(messageId);
      db.prepare('DELETE FROM server_messages WHERE id = ? AND server_id = ? AND channel_id = ?').run(messageId, serverId, channelId);
    })();
    await Promise.all(attachments.map((attachment) => removeFileSafe(path.join(uploadsDir, attachment.path))));
    io.to(getChannelRoom(channelId)).emit('channel:message:delete', { serverId, channelId, messageId });
    return res.json({ deleted: true, messageId });
  } catch (error) {
    console.error('Channel message deletion failed:', error);
    return res.status(500).json({ message: 'Не удалось удалить сообщение.' });
  }
});


app.get('/api/conversations/:id/messages', ensureAuthenticated, (req, res) => {
  const conversationId = Number(req.params.id);
  if (!Number.isFinite(conversationId)) {
    return res.status(400).json({ message: 'Invalid conversation id.' });
  }
  try {
    ensureConversationAccess(conversationId, req.user.id);
  } catch (error) {
    return res.status(error.statusCode || 500).json({ message: error.message });
  }

  const limit = Math.min(Number(req.query.limit) || 40, 100);
  const offset = Number(req.query.offset) || 0;
  const rows = listMessages.all(conversationId, limit, offset);
  const messages = rows.map(serializeMessage).reverse();
  res.json({ messages });
});

app.post('/api/conversations/:id/delivered', ensureAuthenticated, messageLimiter, (req, res) => {
  const conversationId = Number(req.params.id);
  const messageIds = Array.isArray(req.body?.messageIds) ? req.body.messageIds : [];
  if (!Number.isInteger(conversationId) || messageIds.length < 1 || messageIds.length > 100 ||
      messageIds.some((id) => !Number.isInteger(Number(id)) || Number(id) <= 0)) {
    return res.status(400).json({ message: 'Некорректный список доставленных сообщений.' });
  }
  try {
    ensureConversationAccess(conversationId, req.user.id);
    const ids = [...new Set(messageIds.map(Number))];
    const delivered = [];
    const deliver = db.transaction(() => {
      ids.forEach((messageId) => {
        const message = db.prepare('SELECT id, author_id FROM messages WHERE id = ? AND conversation_id = ?').get(messageId, conversationId);
        if (!message || message.author_id === req.user.id) return;
        const result = insertMessageDelivery.run(conversationId, messageId, req.user.id);
        if (result.changes > 0) {
          delivered.push(messageId);
          const delivery = getMessageDelivery({ conversation_id: conversationId, id: messageId, author_id: message.author_id });
          io.to(getUserRoom(message.author_id)).emit('message:delivery:update', { conversationId, messageId, delivery });
        }
      });
    });
    deliver();
    return res.json({ conversationId, deliveredMessageIds: delivered });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ message: error.message || 'Не удалось подтвердить доставку.' });
  }
});

app.patch('/api/conversations/:id/messages/:messageId', ensureAuthenticated, messageLimiter, (req, res) => {
  const conversationId = Number(req.params.id);
  const messageId = Number(req.params.messageId);
  const content = typeof req.body?.content === 'string' ? req.body.content.trim() : '';
  if (!Number.isInteger(conversationId) || !Number.isInteger(messageId) || !content || content.length > 4000) {
    return res.status(400).json({ message: 'Сообщение должно содержать от 1 до 4000 символов.' });
  }
  try {
    ensureConversationAccess(conversationId, req.user.id);
    const existing = db.prepare('SELECT id, author_id, attachment FROM messages WHERE id = ? AND conversation_id = ?').get(messageId, conversationId);
    if (!existing) return res.status(404).json({ message: 'Сообщение не найдено.' });
    if (existing.author_id !== req.user.id) return res.status(403).json({ message: 'Можно редактировать только свои сообщения.' });
    db.prepare('UPDATE messages SET content = ?, edited_at = CURRENT_TIMESTAMP WHERE id = ? AND conversation_id = ?').run(content, messageId, conversationId);
    const message = serializeMessage(selectMessageWithAuthor.get(messageId));
    io.to(getConversationRoom(conversationId)).emit('message:update', { conversationId, message });
    broadcastConversationUpdate(conversationId);
    return res.json({ message });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ message: error.message || 'Не удалось изменить сообщение.' });
  }
});

app.get('/api/conversations/:id/pins', ensureAuthenticated, (req, res) => {
  const conversationId = Number(req.params.id);
  if (!Number.isInteger(conversationId)) return res.status(400).json({ message: 'Некорректный диалог.' });
  try {
    ensureConversationAccess(conversationId, req.user.id);
    const pins = listDmPins.all(conversationId)
      .map(({ message_id }) => serializeMessage(selectMessageWithAuthor.get(message_id)))
      .filter(Boolean);
    return res.json({ pins });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ message: error.message });
  }
});

app.post('/api/conversations/:id/messages/:messageId/pin', ensureAuthenticated, messageLimiter, (req, res) => {
  const conversationId = Number(req.params.id);
  const messageId = Number(req.params.messageId);
  const action = req.body?.action;
  if (!Number.isInteger(conversationId) || !Number.isInteger(messageId) || !['pin', 'unpin'].includes(action)) {
    return res.status(400).json({ message: 'Некорректное действие закрепления.' });
  }
  try {
    ensureConversationAccess(conversationId, req.user.id);
    const message = db.prepare('SELECT id FROM messages WHERE id = ? AND conversation_id = ?').get(messageId, conversationId);
    if (!message) return res.status(404).json({ message: 'Сообщение не найдено.' });
    if (action === 'pin') insertMessagePin.run('dm', messageId, conversationId, null, null, req.user.id);
    else deleteMessagePin.run('dm', messageId);
    const pin = getMessagePin('dm', messageId);
    io.to(getConversationRoom(conversationId)).emit('message:pin:update', { conversationId, messageId, pin });
    return res.json({ messageId, pin });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ message: error.message || 'Не удалось закрепить сообщение.' });
  }
});

app.post('/api/conversations/:id/messages/:messageId/reactions', ensureAuthenticated, messageLimiter, (req, res) => {
  const conversationId = Number(req.params.id);
  const messageId = Number(req.params.messageId);
  const emoji = typeof req.body?.emoji === 'string' ? req.body.emoji : '';
  const allowed = new Set(['👍', '❤️', '😂', '😮', '😢', '🔥', '🎉', '👀']);
  if (!Number.isInteger(conversationId) || !Number.isInteger(messageId) || !allowed.has(emoji)) {
    return res.status(400).json({ message: 'Некорректная реакция.' });
  }
  try {
    ensureConversationAccess(conversationId, req.user.id);
    const message = db.prepare('SELECT id FROM messages WHERE id = ? AND conversation_id = ?').get(messageId, conversationId);
    if (!message) return res.status(404).json({ message: 'Сообщение не найдено.' });
    const existing = db.prepare('SELECT id FROM message_reactions WHERE scope = ? AND message_id = ? AND user_id = ? AND emoji = ?')
      .get('dm', messageId, req.user.id, emoji);
    if (existing) deleteMessageReaction.run('dm', messageId, req.user.id, emoji);
    else insertMessageReaction.run('dm', messageId, req.user.id, emoji);
    const reactions = getMessageReactions('dm', messageId);
    io.to(getConversationRoom(conversationId)).emit('message:reactions:update', { conversationId, messageId, reactions });
    return res.json({ messageId, reactions });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ message: error.message || 'Не удалось добавить реакцию.' });
  }
});

app.post('/api/conversations/:id/read', ensureAuthenticated, (req, res) => {
  const conversationId = Number(req.params.id);
  const requestedMessageId = Number(req.body?.messageId);
  if (!Number.isInteger(conversationId) || !Number.isInteger(requestedMessageId) || requestedMessageId < 0) {
    return res.status(400).json({ message: 'Некорректная отметка прочтения.' });
  }
  try {
    ensureConversationAccess(conversationId, req.user.id);
    const readMessage = requestedMessageId === 0
      ? { id: 0 }
      : db.prepare('SELECT id FROM messages WHERE id = ? AND conversation_id = ?').get(requestedMessageId, conversationId);
    if (!readMessage) return res.status(404).json({ message: 'Сообщение не найдено в этом диалоге.' });
    const lastReadMessageId = readMessage.id;
    updateConversationRead.run(lastReadMessageId, conversationId, req.user.id);
    broadcastConversationUpdate(conversationId);
    return res.json({ conversationId, userId: req.user.id, lastReadMessageId });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ message: error.message || 'Не удалось отметить сообщения прочитанными.' });
  }
});

app.delete('/api/conversations/:id/messages/:messageId', ensureAuthenticated, messageLimiter, async (req, res) => {
  const conversationId = Number(req.params.id);
  const messageId = Number(req.params.messageId);
  if (!Number.isInteger(conversationId) || !Number.isInteger(messageId)) {
    return res.status(400).json({ message: 'Некорректный идентификатор сообщения.' });
  }
  try { ensureConversationAccess(conversationId, req.user.id); }
  catch (error) { return res.status(error.statusCode || 500).json({ message: error.message }); }
  const message = db.prepare('SELECT id, author_id FROM messages WHERE id = ? AND conversation_id = ?').get(messageId, conversationId);
  if (!message) return res.status(404).json({ message: 'Сообщение не найдено.' });
  if (message.author_id !== req.user.id) return res.status(403).json({ message: 'Можно удалять только свои сообщения.' });
  const attachments = db.prepare('SELECT path FROM attachments WHERE message_id = ?').all(messageId);
  try {
    db.transaction(() => {
      db.prepare("DELETE FROM message_reactions WHERE scope = 'dm' AND message_id = ?").run(messageId);
      db.prepare("DELETE FROM message_pins WHERE scope = 'dm' AND message_id = ?").run(messageId);
      db.prepare('DELETE FROM message_deliveries WHERE conversation_id = ? AND message_id = ?').run(conversationId, messageId);
      db.prepare('DELETE FROM attachments WHERE message_id = ?').run(messageId);
      db.prepare('DELETE FROM messages WHERE id = ? AND conversation_id = ?').run(messageId, conversationId);
      db.prepare('UPDATE conversations SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(conversationId);
    })();
    await Promise.all(attachments.map((attachment) => removeFileSafe(path.join(uploadsDir, attachment.path))));
    io.to(getConversationRoom(conversationId)).emit('message:delete', { conversationId, messageId });
    broadcastConversationUpdate(conversationId);
    return res.json({ deleted: true, messageId });
  } catch (error) {
    console.error('DM message deletion failed:', error);
    return res.status(500).json({ message: 'Не удалось удалить сообщение.' });
  }
});

app.get('/api/files/:conversationId/:attachmentId', ensureAuthenticated, (req, res) => {
  const conversationId = Number(req.params.conversationId);
  const attachmentId = req.params.attachmentId;
  if (!Number.isFinite(conversationId) || !attachmentId) {
    return res.status(400).json({ message: 'Invalid parameters.' });
  }

  try {
    ensureConversationAccess(conversationId, req.user.id);
  } catch (error) {
    return res.status(error.statusCode || 500).json({ message: error.message });
  }

  const attachment = selectAttachmentById.get(attachmentId);
  if (!attachment || attachment.conversation_id !== conversationId) {
    return res.status(404).json({ message: 'Attachment not found.' });
  }

  const absolutePath = path.join(uploadsDir, attachment.path);
  if (!absolutePath.startsWith(uploadsDir) || !fs.existsSync(absolutePath)) {
    return res.status(404).json({ message: 'File missing.' });
  }

  res.setHeader('Content-Type', attachment.mime);
  res.setHeader(
    'Content-Disposition',
    `inline; filename="${attachment.name.replace(/"/g, '')}"`
  );
  res.sendFile(absolutePath);
});

app.post(
  '/api/conversations/:id/messages',
  ensureAuthenticated,
  messageLimiter,
  upload.single('attachment'),
  async (req, res) => {
    const conversationId = Number(req.params.id);
    if (!Number.isFinite(conversationId)) {
      if (req.file) await removeFileSafe(req.file.path);
      return res.status(400).json({ message: 'Invalid conversation id.' });
    }

    let attachmentPayload = null;
    if (req.file) {
      try {
        attachmentPayload = await processDmAttachment(req.file, conversationId);
      } catch (error) {
        return res.status(error.statusCode || 400).json({ message: error.message });
      }
    }

    try {
      const message = createMessage(conversationId, req.user.id, req.body.content, attachmentPayload, req.body.replyToMessageId);
      res.status(201).json({ message });
    } catch (error) {
      if (attachmentPayload) {
        await removeFileSafe(path.join(uploadsDir, attachmentPayload.storagePath));
      } else if (req.file) {
        await removeFileSafe(req.file.path);
      }
      res.status(error.statusCode || 500).json({ message: error.message });
    }
  }
);

app.post('/api/auth/logout', (req, res) => {
  req.logout((err) => {
    if (err) {
      return res.status(500).json({ message: 'Logout failed.' });
    }
    req.session.destroy(() => {
      res.clearCookie('connect.sid');
      res.json({ success: true });
    });
  });
});

app.get('/api/auth/providers', (_req, res) => {
  res.json({ github: githubReady });
});

app.get('/api/auth/session', (req, res) => {
  res.json({ user: sanitizeUser(req.user) });
});

app.get('/api/auth/status', (req, res) => {
  res.json({ authenticated: !!req.user });
});

app.get('/api/auth/github', (req, res, next) => {
  if (!githubReady) {
    return res.status(503).json({ message: 'GitHub OAuth is not configured.' });
  }
  passport.authenticate('github')(req, res, next);
});

app.get(
  '/api/auth/github/callback',
  (req, res, next) => {
    if (!githubReady) {
      return res.redirect('/?error=github_not_configured');
    }
    next();
  },
  passport.authenticate('github', {
    failureRedirect: '/?error=github_failed'
  }),
  (req, res) => {
    res.redirect('/?auth=github_success');
  }
);

app.use(express.static(publicDir));

app.use((err, _req, res, next) => {
  if (err.code === 'EBADCSRFTOKEN') {
    return res.status(403).json({ message: 'Invalid or missing CSRF token.' });
  }
  return next(err);
});

// Неизвестные API-маршруты — честный 404 в JSON, а не index.html со статусом 200
app.use('/api', (_req, res) => {
  res.status(404).json({ message: 'Not found.' });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

// Десктопный сервер слушает только loopback, чтобы он не был виден из локальной сети.
const HOST = process.env.HOST || (isDesktop ? '127.0.0.1' : '0.0.0.0');

server.listen(PORT, HOST, () => {
  console.log(`Auth service listening on http://${HOST}:${PORT}`);
  console.log(`Public directory: ${publicDir}`);
  console.log(`Data directory: ${dataDir}`);
  if (!githubReady) {
    console.warn('GitHub OAuth is disabled. Set GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET to enable it.');
  }
});

// Обработка ошибок сервера
server.on('error', (error) => {
  console.error('Server error:', error);
  process.exit(1);
});

// Обработка неперехваченных ошибок
process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error);
  process.exit(1);
});

// Необработанный rejection (например, обрыв Redis или сбой одного запроса) не должен
// убивать весь сервер и все активные чаты — только логируем.
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection:', reason);
});
