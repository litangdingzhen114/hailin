const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const ADMIN_DIR = path.join(__dirname, 'admin');

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;

  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const separator = trimmed.indexOf('=');
    if (separator === -1) continue;

    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if (!key || process.env[key]) continue;

    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

function resolveStorageDir() {
  const configured = process.env.STORAGE_DIR;
  if (!configured) return path.join(__dirname, 'storage');
  return path.isAbsolute(configured) ? configured : path.resolve(ROOT, configured);
}

loadEnvFile(path.join(__dirname, '.env'));

const HOST = process.env.HOST || '127.0.0.1';
const PORT = Number(process.env.PORT || 8787);
const NODE_ENV = process.env.NODE_ENV || 'development';
const STORAGE_DIR = resolveStorageDir();
const LOG_DIR = path.join(STORAGE_DIR, 'logs');
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || '').replace(/\/+$/, '');
const KIMI_API_KEY = process.env.KIMI_API_KEY || process.env.MOONSHOT_API_KEY || '';
const KIMI_BASE_URL = (process.env.KIMI_BASE_URL || 'https://api.moonshot.cn/v1').replace(/\/+$/, '');
const KIMI_MODEL = process.env.KIMI_MODEL || 'kimi-k2.6';
const ADMIN_USER = process.env.ADMIN_USER || 'hailin-admin';
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || (NODE_ENV === 'production' ? '' : 'hailin-admin-dev-token');
const CONFIGURED_ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean);
const ALLOWED_ORIGINS = CONFIGURED_ALLOWED_ORIGINS.length
  ? CONFIGURED_ALLOWED_ORIGINS
  : (NODE_ENV === 'production' && PUBLIC_BASE_URL ? [PUBLIC_BASE_URL] : []);
const RATE_LIMIT_WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS || 60 * 1000);
const RATE_LIMIT_MAX = Number(process.env.RATE_LIMIT_MAX || 240);
const ADMIN_RATE_LIMIT_MAX = Number(process.env.ADMIN_RATE_LIMIT_MAX || 600);

const banners = require('../miniprogram/data/banners');
const gridPages = require('../miniprogram/data/homeGrids');
const products = require('../miniprogram/data/products');
const recommend = require('../miniprogram/data/recommend');
const mapPoints = require('../miniprogram/data/mapPoints');
const foods = require('../miniprogram/data/foods');
const lives = require('../miniprogram/data/lives');

const LOCATION_TEXT = '浙江省丽水市青田县海口镇海林村';
const REGION_KEYWORDS = ['瓯江', '青田石', '田鱼', '侨乡', '山水村落'];
const BOOKING_STATUSES = ['new', 'confirmed', 'processing', 'completed', 'cancelled'];
const FEEDBACK_STATUSES = ['new', 'processing', 'resolved', 'archived'];
const AUDIT_FILE = 'audit.json';
const HOME_CONTENT_FILE = 'home-content.json';
const HOME_CONTENT_VERSION = '1';
const rateBuckets = new Map();

class HttpError extends Error {
  constructor(statusCode, message, detail) {
    super(message);
    this.statusCode = statusCode;
    this.detail = detail;
  }
}

function ensureStorage() {
  fs.mkdirSync(STORAGE_DIR, { recursive: true });
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

function clientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) return String(forwarded).split(',')[0].trim();
  return req.socket.remoteAddress || 'unknown';
}

function corsHeaders(req) {
  const origin = req.headers.origin;
  const headers = {
    'Access-Control-Allow-Methods': 'GET,POST,PATCH,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Admin-Token',
    'Access-Control-Max-Age': '86400'
  };

  if (!ALLOWED_ORIGINS.length) {
    headers['Access-Control-Allow-Origin'] = '*';
    return headers;
  }

  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers.Vary = 'Origin';
  }
  return headers;
}

function httpsEnabled() {
  return /^https:\/\//i.test(PUBLIC_BASE_URL);
}

function validateStartupConfig() {
  if (NODE_ENV !== 'production') return;
  if (!ADMIN_TOKEN) {
    throw new Error('ADMIN_TOKEN is required in production');
  }
  if (ADMIN_TOKEN === 'hailin-admin-dev-token' || ADMIN_TOKEN.length < 24) {
    throw new Error('ADMIN_TOKEN must be a strong random value with at least 24 characters');
  }
  if (!httpsEnabled()) {
    throw new Error('PUBLIC_BASE_URL must be an HTTPS URL in production');
  }
}

function securityHeaders(extra = {}) {
  const headers = {
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'X-Frame-Options': 'DENY',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'Cache-Control': 'no-store'
  };
  if (NODE_ENV === 'production' && httpsEnabled()) {
    headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains';
  }
  return {
    ...headers,
    ...extra
  };
}

function sendJson(req, res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    ...corsHeaders(req),
    ...securityHeaders(),
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'X-Request-Id': req.requestId
  });
  res.end(body);
}

function sendText(req, res, statusCode, body, headers = {}) {
  res.writeHead(statusCode, {
    ...corsHeaders(req),
    ...securityHeaders(headers),
    'Content-Length': Buffer.byteLength(body),
    'X-Request-Id': req.requestId
  });
  res.end(body);
}

function sendError(req, res, statusCode, message, detail) {
  sendJson(req, res, statusCode, {
    error: {
      message,
      detail: detail || undefined
    }
  });
}

function sendOptions(req, res) {
  res.writeHead(204, {
    ...corsHeaders(req),
    ...securityHeaders(),
    'X-Request-Id': req.requestId
  });
  res.end();
}

function isRateLimited(req, pathname) {
  const scope = pathname.startsWith('/api/admin') ? 'admin' : 'public';
  const max = scope === 'admin' ? ADMIN_RATE_LIMIT_MAX : RATE_LIMIT_MAX;
  if (!max || max < 1) return false;

  const key = `${scope}:${clientIp(req)}`;
  const now = Date.now();
  const bucket = rateBuckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    rateBuckets.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return false;
  }

  bucket.count += 1;
  return bucket.count > max;
}

function logEvent(event) {
  try {
    ensureStorage();
    const date = new Date().toISOString().slice(0, 10);
    const logPath = path.join(LOG_DIR, `${date}.log`);
    fs.appendFile(logPath, `${JSON.stringify({ time: new Date().toISOString(), ...event })}\n`, () => {});
  } catch {
    // Logging must never break the public service.
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;

    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > 1024 * 1024) {
        reject(new HttpError(413, 'Request body is too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      if (!chunks.length) {
        resolve({});
        return;
      }

      const raw = Buffer.concat(chunks).toString('utf8');
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new HttpError(400, 'Request body must be valid JSON'));
      }
    });

    req.on('error', reject);
  });
}

function storagePath(fileName) {
  return path.join(STORAGE_DIR, fileName);
}

function readRecords(fileName) {
  ensureStorage();
  const filePath = storagePath(fileName);
  if (!fs.existsSync(filePath)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    const backupPath = `${filePath}.corrupt-${Date.now()}`;
    try {
      fs.copyFileSync(filePath, backupPath);
    } catch {
      // Ignore backup failures and return a safe empty collection.
    }
    logEvent({ level: 'error', message: 'storage_read_failed', fileName, detail: error.message });
    return [];
  }
}

function writeRecords(fileName, records) {
  ensureStorage();
  const filePath = storagePath(fileName);
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(records, null, 2), 'utf8');
  fs.renameSync(tempPath, filePath);
}

function readJsonObject(fileName) {
  ensureStorage();
  const filePath = storagePath(fileName);
  if (!fs.existsSync(filePath)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch (error) {
    const backupPath = `${filePath}.corrupt-${Date.now()}`;
    try {
      fs.copyFileSync(filePath, backupPath);
    } catch {
      // Ignore backup failures and return a safe default object.
    }
    logEvent({ level: 'error', message: 'storage_object_read_failed', fileName, detail: error.message });
    return null;
  }
}

function writeJsonObject(fileName, payload) {
  ensureStorage();
  const filePath = storagePath(fileName);
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(payload, null, 2), 'utf8');
  fs.renameSync(tempPath, filePath);
}

function appendRecord(fileName, payload) {
  const records = readRecords(fileName);
  const record = {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    status: 'new',
    ...payload
  };
  records.unshift(record);
  writeRecords(fileName, records);
  return record;
}

function appendAudit(req, action, targetType, targetId, detail = {}) {
  const audit = readRecords(AUDIT_FILE);
  const entry = {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    action,
    targetType,
    targetId: cleanText(targetId, 120),
    adminUser: targetType === 'public' ? 'public' : ADMIN_USER,
    requestId: req.requestId,
    ip: clientIp(req),
    detail
  };
  audit.unshift(entry);
  writeRecords(AUDIT_FILE, audit.slice(0, 5000));
  return entry;
}

function updateRecordStatus(fileName, id, allowedStatuses, status, note) {
  if (!allowedStatuses.includes(status)) {
    throw new HttpError(400, 'Invalid status', `Allowed: ${allowedStatuses.join(', ')}`);
  }

  const records = readRecords(fileName);
  const index = records.findIndex((item) => item.id === id);
  if (index === -1) throw new HttpError(404, 'Record not found');

  records[index] = {
    ...records[index],
    status,
    adminNote: cleanText(note, 500),
    updatedAt: new Date().toISOString()
  };
  writeRecords(fileName, records);
  return records[index];
}

function updateRecordsStatus(fileName, ids, allowedStatuses, status, note) {
  if (!Array.isArray(ids) || !ids.length) {
    throw new HttpError(400, 'Ids are required');
  }
  if (ids.length > 100) {
    throw new HttpError(400, 'Bulk update supports at most 100 records');
  }
  if (!allowedStatuses.includes(status)) {
    throw new HttpError(400, 'Invalid status', `Allowed: ${allowedStatuses.join(', ')}`);
  }

  const idSet = new Set(ids.map((id) => cleanText(id, 120)).filter(Boolean));
  const records = readRecords(fileName);
  const updated = [];
  const now = new Date().toISOString();
  for (let index = 0; index < records.length; index += 1) {
    if (!idSet.has(records[index].id)) continue;
    records[index] = {
      ...records[index],
      status,
      adminNote: cleanText(note, 500),
      updatedAt: now
    };
    updated.push(records[index]);
  }

  if (!updated.length) throw new HttpError(404, 'No matching records found');
  writeRecords(fileName, records);
  return updated;
}

function cleanText(value, maxLength = 200) {
  return String(value || '').trim().slice(0, maxLength);
}

function normalizePositiveInt(value, fallback, min, max) {
  if (value == null || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function validateBooking(body) {
  const contact = cleanText(body.contact, 80);
  if (!contact) throw new HttpError(400, 'Contact is required');

  const people = Number(body.people);
  if (!Number.isInteger(people) || people < 1 || people > 50) {
    throw new HttpError(400, 'People must be an integer between 1 and 50');
  }

  return {
    service: cleanText(body.service, 80) || '海林村讲解服务',
    date: cleanText(body.date, 40) || new Date().toISOString().slice(0, 10),
    people,
    contact,
    remark: cleanText(body.remark || body.note, 500),
    source: cleanText(body.source, 40) || 'mini-program'
  };
}

function validateFeedback(body) {
  const content = cleanText(body.content || body.message, 800);
  if (!content) throw new HttpError(400, 'Feedback content is required');

  return {
    nickname: cleanText(body.nickname || body.name, 80) || '游客',
    contact: cleanText(body.contact, 80),
    content,
    source: cleanText(body.source, 40) || 'mini-program'
  };
}

function homePayload() {
  return {
    banners,
    gridPages,
    products,
    hotRecommends: recommend.hotRecommends,
    rankings: recommend.rankings,
    corridor: recommend.corridor,
    feeds: recommend.feeds,
    notice: '海林村真实后端已接入：预约、反馈、慢直播与 AI 导游由本地服务提供',
    weather: '青田海口镇今日多云，瓯江沿线适合村游慢行',
    serviceMode: '真实服务已连接',
    locationText: LOCATION_TEXT
  };
}

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function defaultHomeContent() {
  return deepClone(homePayload());
}

function sanitizeJsonValue(value, depth = 0) {
  if (depth > 5) return undefined;
  if (typeof value === 'string') return cleanText(value, 800);
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'boolean') return value;
  if (Array.isArray(value)) {
    return value
      .slice(0, 80)
      .map((item) => sanitizeJsonValue(item, depth + 1))
      .filter((item) => item !== undefined);
  }
  if (value && typeof value === 'object') {
    const result = {};
    for (const [key, item] of Object.entries(value).slice(0, 60)) {
      const safeKey = cleanText(key, 80);
      if (!safeKey) continue;
      const safeValue = sanitizeJsonValue(item, depth + 1);
      if (safeValue !== undefined) result[safeKey] = safeValue;
    }
    return result;
  }
  return undefined;
}

function sanitizeContentList(value, fallback, limit) {
  if (!Array.isArray(value)) return deepClone(fallback);
  return value
    .slice(0, limit)
    .map((item) => sanitizeJsonValue(item))
    .filter((item) => item && typeof item === 'object' && Object.keys(item).length);
}

function sanitizeHomeContent(input) {
  const defaults = defaultHomeContent();
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new HttpError(400, 'Home content must be an object');
  }

  return {
    banners: sanitizeContentList(input.banners, defaults.banners, 8),
    gridPages: sanitizeContentList(input.gridPages, defaults.gridPages, 6),
    products: sanitizeContentList(input.products, defaults.products, 24),
    hotRecommends: sanitizeContentList(input.hotRecommends, defaults.hotRecommends, 12),
    rankings: sanitizeContentList(input.rankings, defaults.rankings, 8),
    corridor: sanitizeContentList(input.corridor, defaults.corridor, 16),
    feeds: sanitizeContentList(input.feeds, defaults.feeds, 30),
    notice: cleanText(input.notice, 240) || defaults.notice,
    weather: cleanText(input.weather, 180) || defaults.weather,
    serviceMode: cleanText(input.serviceMode, 80) || defaults.serviceMode,
    locationText: cleanText(input.locationText, 160) || defaults.locationText
  };
}

function homeContentStats(content) {
  return {
    banners: content.banners.length,
    gridItems: content.gridPages.reduce((total, page) => total + (Array.isArray(page.items) ? page.items.length : 0), 0),
    products: content.products.length,
    hotRecommends: content.hotRecommends.length,
    rankings: content.rankings.length,
    corridor: content.corridor.length,
    feeds: content.feeds.length
  };
}

function defaultHomeEnvelope() {
  const content = defaultHomeContent();
  return {
    meta: {
      source: 'defaults',
      version: HOME_CONTENT_VERSION,
      updatedAt: '',
      updatedBy: '',
      stats: homeContentStats(content)
    },
    content
  };
}

function readHomeContentEnvelope() {
  const stored = readJsonObject(HOME_CONTENT_FILE);
  if (!stored || !stored.content) return defaultHomeEnvelope();

  const content = sanitizeHomeContent(stored.content);
  return {
    meta: {
      source: 'storage',
      version: cleanText(stored.version, 20) || HOME_CONTENT_VERSION,
      updatedAt: cleanText(stored.updatedAt, 40),
      updatedBy: cleanText(stored.updatedBy, 80),
      stats: homeContentStats(content)
    },
    content
  };
}

function saveHomeContent(req, rawContent) {
  const content = sanitizeHomeContent(rawContent);
  const stored = {
    version: HOME_CONTENT_VERSION,
    updatedAt: new Date().toISOString(),
    updatedBy: ADMIN_USER,
    content
  };
  writeJsonObject(HOME_CONTENT_FILE, stored);
  appendAudit(req, 'home-content.updated', 'home-content', 'home', {
    updatedAt: stored.updatedAt,
    stats: homeContentStats(content)
  });
  return readHomeContentEnvelope();
}

function resetHomeContent(req) {
  const filePath = storagePath(HOME_CONTENT_FILE);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  appendAudit(req, 'home-content.reset', 'home-content', 'home', {});
  return defaultHomeEnvelope();
}

function managedHomePayload() {
  const envelope = readHomeContentEnvelope();
  return {
    ...envelope.content,
    contentMeta: envelope.meta
  };
}

function livePayload(req) {
  const origin = PUBLIC_BASE_URL || `http://${req.headers.host || `${HOST}:${PORT}`}`;
  return lives.map((item) => ({
    ...item,
    liveUrl: `${origin}/media/hailin-live.mp4`,
    hlsUrl: ''
  }));
}

function localGuideReply(question) {
  const text = String(question || '');
  if (text.includes('路线') || text.includes('怎么玩')) {
    return '推荐“瓯江山村半日游”：村口会客点集合，沿溪谷步道慢行，中午安排海林田鱼家宴，下午可做青田石纹手作。';
  }
  if (text.includes('美食') || text.includes('吃') || text.includes('田鱼')) {
    return '海林村可以把青田田鱼、山泉豆腐、溪畔茶点和侨乡咖啡作为主线。第一次来建议先预约田鱼家宴，再去溪边茶点慢坐。';
  }
  if (text.includes('直播') || text.includes('摄像头')) {
    return '慢直播已按村口会客点、稻鱼田、溪谷步道和侨乡小院组织点位。真实摄像头或 HLS 地址可以由后端替换 liveUrl。';
  }
  if (text.includes('停车') || text.includes('导航')) {
    return '建议先导航到海口镇海林村游客中心，停车点和公共服务点可在全域旅游地图里查看。节假日以现场交通指引为准。';
  }
  if (text.includes('住宿') || text.includes('民宿')) {
    return '住宿可以优先包装溪谷慢住和侨乡小院，后续接入房态后，可把可订日期、房型和订单状态同步到小程序。';
  }
  return '我是海林村 AI 导游小林。你可以问我路线、美食、停车、慢直播、研学、民宿和青田地域文化。';
}

function buildAiPrompt(body) {
  const message = String(body.message || body.question || '').trim();
  const history = Array.isArray(body.history) ? body.history.slice(-6) : [];
  const historyText = history
    .map((item) => `${item.role || 'user'}：${item.content || item.message || ''}`)
    .filter(Boolean)
    .join('\n');

  return {
    message,
    input: [
      historyText ? `历史对话：\n${historyText}` : '',
      `游客问题：${message}`
    ].filter(Boolean).join('\n\n')
  };
}

function extractChatCompletionText(result) {
  const message = result && result.choices && result.choices[0] && result.choices[0].message;
  if (!message) return '';
  if (typeof message.content === 'string') return message.content.trim();
  if (!Array.isArray(message.content)) return '';

  return message.content
    .map((part) => {
      if (typeof part === 'string') return part;
      return part.text || part.content || '';
    })
    .filter(Boolean)
    .join('\n')
    .trim();
}

async function askKimi(body) {
  if (!KIMI_API_KEY) return null;

  const prompt = buildAiPrompt(body);
  const instructions = [
    '你是浙江省丽水市青田县海口镇海林村小程序里的 AI 导游。',
    '回答要短、实用、适合游客阅读。优先围绕瓯江、青田石、田鱼、侨乡、山水村落和海林村服务点。',
    '不要编造具体营业执照、电话、价格或实时余位。涉及预约、价格、直播、房态时提示以后端实时信息为准。'
  ].join('\n');

  const response = await fetch(`${KIMI_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${KIMI_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: KIMI_MODEL,
      messages: [
        { role: 'system', content: instructions },
        { role: 'user', content: prompt.input }
      ],
      temperature: 0.3
    })
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Kimi request failed: ${response.status} ${detail}`);
  }

  const result = await response.json();
  return extractChatCompletionText(result);
}

function safeCompareToken(left, right) {
  if (!left || !right) return false;
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) return false;
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function adminTokenFromRequest(req) {
  const auth = String(req.headers.authorization || '');
  if (auth.startsWith('Bearer ')) return auth.slice(7).trim();
  return String(req.headers['x-admin-token'] || '').trim();
}

function requireAdmin(req, res) {
  if (!ADMIN_TOKEN) {
    sendError(req, res, 503, 'Admin token is not configured');
    return false;
  }

  if (!safeCompareToken(adminTokenFromRequest(req), ADMIN_TOKEN)) {
    logEvent({
      level: 'warn',
      message: 'admin_unauthorized',
      path: req.url,
      ip: clientIp(req)
    });
    sendError(req, res, 401, 'Unauthorized');
    return false;
  }
  return true;
}

function countByStatus(records, statuses) {
  const counts = { total: records.length };
  for (const status of statuses) counts[status] = 0;
  for (const record of records) {
    counts[record.status] = (counts[record.status] || 0) + 1;
  }
  return counts;
}

function todayCount(records) {
  const today = new Date().toISOString().slice(0, 10);
  return records.filter((item) => String(item.createdAt || '').startsWith(today)).length;
}

function storageWritable() {
  try {
    ensureStorage();
    const probe = path.join(STORAGE_DIR, `.write-probe-${process.pid}`);
    fs.writeFileSync(probe, 'ok');
    fs.unlinkSync(probe);
    return true;
  } catch {
    return false;
  }
}

function adminSummary() {
  const bookings = readRecords('bookings.json');
  const feedback = readRecords('feedback.json');
  const homeContent = readHomeContentEnvelope();
  return {
    counts: {
      bookings: { ...countByStatus(bookings, BOOKING_STATUSES), today: todayCount(bookings) },
      feedback: { ...countByStatus(feedback, FEEDBACK_STATUSES), today: todayCount(feedback) },
      lives: { total: lives.length },
      mapPoints: { total: mapPoints.length },
      homeContent: {
        source: homeContent.meta.source,
        updatedAt: homeContent.meta.updatedAt,
        ...homeContent.meta.stats
      }
    },
    recent: {
      bookings: bookings.slice(0, 5),
      feedback: feedback.slice(0, 5)
    },
    system: {
      environment: NODE_ENV,
      adminUser: ADMIN_USER,
      storageWritable: storageWritable(),
      aiProvider: KIMI_API_KEY ? 'kimi' : 'local',
      aiModel: KIMI_API_KEY ? KIMI_MODEL : undefined,
      publicBaseUrl: PUBLIC_BASE_URL || undefined,
      security: {
        publicBaseUrl: PUBLIC_BASE_URL || '',
        httpsEnabled: httpsEnabled(),
        adminTokenConfigured: Boolean(ADMIN_TOKEN),
        corsRestricted: Boolean(ALLOWED_ORIGINS.length),
        allowedOrigins: ALLOWED_ORIGINS
      },
      uptimeSeconds: Math.round(process.uptime())
    }
  };
}

function matchesQuery(record, search) {
  if (!search) return true;
  const lower = search.toLowerCase();
  return JSON.stringify(record).toLowerCase().includes(lower);
}

function listAdminRecords(fileName, query) {
  const page = normalizePositiveInt(query.get('page'), 1, 1, 1000);
  const pageSize = normalizePositiveInt(query.get('pageSize'), 20, 1, 100);
  const status = cleanText(query.get('status'), 40);
  const search = cleanText(query.get('q'), 120);
  const all = readRecords(fileName)
    .filter((record) => !status || record.status === status)
    .filter((record) => matchesQuery(record, search));
  const start = (page - 1) * pageSize;

  return {
    items: all.slice(start, start + pageSize),
    page,
    pageSize,
    total: all.length
  };
}

function listAuditRecords(query) {
  const page = normalizePositiveInt(query.get('page'), 1, 1, 1000);
  const pageSize = normalizePositiveInt(query.get('pageSize'), 30, 1, 100);
  const action = cleanText(query.get('action'), 80);
  const targetType = cleanText(query.get('targetType'), 40);
  const search = cleanText(query.get('q'), 120);
  const all = readRecords(AUDIT_FILE)
    .filter((record) => !action || record.action === action)
    .filter((record) => !targetType || record.targetType === targetType)
    .filter((record) => matchesQuery(record, search));
  const start = (page - 1) * pageSize;

  return {
    items: all.slice(start, start + pageSize),
    page,
    pageSize,
    total: all.length
  };
}

function backupPayload() {
  const bookings = readRecords('bookings.json');
  const feedback = readRecords('feedback.json');
  const audit = readRecords(AUDIT_FILE);
  const homeContent = readHomeContentEnvelope();

  return {
    meta: {
      service: 'hailin-backend',
      generatedAt: new Date().toISOString(),
      version: '1',
      counts: {
        bookings: bookings.length,
        feedback: feedback.length,
        audit: audit.length
      }
    },
    data: {
      bookings,
      feedback,
      audit,
      homeContent
    }
  };
}

function csvEscape(value) {
  const text = String(value == null ? '' : value);
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function recordsToCsv(type, records) {
  const headers = type === 'feedback'
    ? ['id', 'createdAt', 'status', 'nickname', 'contact', 'content', 'adminNote']
    : ['id', 'createdAt', 'status', 'service', 'date', 'people', 'contact', 'remark', 'adminNote'];
  const rows = [headers.join(',')];
  for (const record of records) {
    rows.push(headers.map((header) => csvEscape(record[header])).join(','));
  }
  return `\uFEFF${rows.join('\n')}`;
}

function contentType(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  return {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.svg': 'image/svg+xml'
  }[extension] || 'application/octet-stream';
}

function serveStaticFile(req, res, filePath, cacheControl = 'no-store') {
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    sendError(req, res, 404, 'Not found');
    return;
  }

  const body = fs.readFileSync(filePath);
  res.writeHead(200, {
    ...securityHeaders({
      'Content-Type': contentType(filePath),
      'Cache-Control': cacheControl,
      'Content-Security-Policy': "default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; base-uri 'none'; form-action 'none'"
    }),
    'Content-Length': body.length,
    'X-Request-Id': req.requestId
  });
  res.end(body);
}

function isInsideDirectory(parentDir, filePath) {
  const relative = path.relative(parentDir, filePath);
  return Boolean(relative) && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function serveAdmin(req, res, pathname) {
  const relative = pathname === '/admin' || pathname === '/admin/' ? 'index.html' : pathname.replace(/^\/admin\/?/, '');
  const filePath = path.resolve(ADMIN_DIR, relative);
  if (!isInsideDirectory(ADMIN_DIR, filePath)) {
    sendError(req, res, 403, 'Forbidden');
    return;
  }
  serveStaticFile(req, res, filePath);
}

function serveVideo(req, res) {
  const videoPath = path.join(ROOT, 'miniprogram', 'assets', 'videos', 'hailin-live.mp4');
  if (!fs.existsSync(videoPath)) {
    sendError(req, res, 404, 'Video not found');
    return;
  }

  const stat = fs.statSync(videoPath);
  const range = req.headers.range;

  if (!range) {
    res.writeHead(200, {
      ...corsHeaders(req),
      ...securityHeaders(),
      'Content-Type': 'video/mp4',
      'Content-Length': stat.size,
      'Accept-Ranges': 'bytes',
      'X-Request-Id': req.requestId
    });
    fs.createReadStream(videoPath).pipe(res);
    return;
  }

  const match = range.match(/bytes=(\d+)-(\d*)/);
  const start = match ? Number(match[1]) : 0;
  const end = match && match[2] ? Number(match[2]) : stat.size - 1;
  const chunkSize = end - start + 1;

  res.writeHead(206, {
    ...corsHeaders(req),
    ...securityHeaders(),
    'Content-Type': 'video/mp4',
    'Content-Length': chunkSize,
    'Content-Range': `bytes ${start}-${end}/${stat.size}`,
    'Accept-Ranges': 'bytes',
    'X-Request-Id': req.requestId
  });
  fs.createReadStream(videoPath, { start, end }).pipe(res);
}

async function handleAdminRequest(req, res, url, route) {
  if (!requireAdmin(req, res)) return;

  if (route === 'GET /api/admin/session') {
    sendJson(req, res, 200, { data: { user: ADMIN_USER, environment: NODE_ENV } });
    return;
  }
  if (route === 'GET /api/admin/summary') {
    sendJson(req, res, 200, { data: adminSummary() });
    return;
  }
  if (route === 'GET /api/admin/home-content') {
    sendJson(req, res, 200, { data: readHomeContentEnvelope() });
    return;
  }
  if (route === 'PUT /api/admin/home-content') {
    const body = await readBody(req);
    const envelope = saveHomeContent(req, body.content || body);
    sendJson(req, res, 200, { data: envelope });
    return;
  }
  if (route === 'POST /api/admin/home-content/reset') {
    sendJson(req, res, 200, { data: resetHomeContent(req) });
    return;
  }
  if (route === 'GET /api/admin/bookings') {
    sendJson(req, res, 200, { data: listAdminRecords('bookings.json', url.searchParams) });
    return;
  }
  if (route === 'GET /api/admin/feedback') {
    sendJson(req, res, 200, { data: listAdminRecords('feedback.json', url.searchParams) });
    return;
  }
  if (route === 'GET /api/admin/audit') {
    sendJson(req, res, 200, { data: listAuditRecords(url.searchParams) });
    return;
  }
  if (route === 'GET /api/admin/backup') {
    appendAudit(req, 'backup.exported', 'system', 'backup', {
      format: 'json'
    });
    const backup = JSON.stringify(backupPayload(), null, 2);
    sendText(req, res, 200, backup, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="hailin-backup-${new Date().toISOString().slice(0, 10)}.json"`
    });
    return;
  }
  if (route === 'GET /api/admin/export') {
    const type = url.searchParams.get('type') === 'feedback' ? 'feedback' : 'bookings';
    const fileName = type === 'feedback' ? 'feedback.json' : 'bookings.json';
    const csv = recordsToCsv(type, readRecords(fileName));
    appendAudit(req, `${type}.csv.exported`, type, 'export', {
      format: 'csv'
    });
    sendText(req, res, 200, csv, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="hailin-${type}.csv"`
    });
    return;
  }

  if (route === 'PATCH /api/admin/bookings/bulk-status') {
    const body = await readBody(req);
    const items = updateRecordsStatus('bookings.json', body.ids, BOOKING_STATUSES, cleanText(body.status), body.note);
    appendAudit(req, 'booking.bulk-status.updated', 'booking', 'bulk', {
      ids: items.map((item) => item.id),
      status: cleanText(body.status),
      note: cleanText(body.note, 500)
    });
    sendJson(req, res, 200, { data: { updated: items.length, items } });
    return;
  }

  if (route === 'PATCH /api/admin/feedback/bulk-status') {
    const body = await readBody(req);
    const items = updateRecordsStatus('feedback.json', body.ids, FEEDBACK_STATUSES, cleanText(body.status), body.note);
    appendAudit(req, 'feedback.bulk-status.updated', 'feedback', 'bulk', {
      ids: items.map((item) => item.id),
      status: cleanText(body.status),
      note: cleanText(body.note, 500)
    });
    sendJson(req, res, 200, { data: { updated: items.length, items } });
    return;
  }

  const bookingStatus = route.match(/^PATCH \/api\/admin\/bookings\/([^/]+)\/status$/);
  if (bookingStatus) {
    const body = await readBody(req);
    const record = updateRecordStatus('bookings.json', bookingStatus[1], BOOKING_STATUSES, cleanText(body.status), body.note);
    appendAudit(req, 'booking.status.updated', 'booking', record.id, {
      status: record.status,
      note: record.adminNote
    });
    sendJson(req, res, 200, { data: record });
    return;
  }

  const feedbackStatus = route.match(/^PATCH \/api\/admin\/feedback\/([^/]+)\/status$/);
  if (feedbackStatus) {
    const body = await readBody(req);
    const record = updateRecordStatus('feedback.json', feedbackStatus[1], FEEDBACK_STATUSES, cleanText(body.status), body.note);
    appendAudit(req, 'feedback.status.updated', 'feedback', record.id, {
      status: record.status,
      note: record.adminNote
    });
    sendJson(req, res, 200, { data: record });
    return;
  }

  sendError(req, res, 404, 'Not found');
}

async function handleRequest(req, res) {
  req.requestId = crypto.randomUUID();
  const startedAt = Date.now();
  const url = new URL(req.url, `http://${req.headers.host || `${HOST}:${PORT}`}`);
  const route = `${req.method} ${url.pathname}`;

  res.on('finish', () => {
    logEvent({
      requestId: req.requestId,
      method: req.method,
      path: url.pathname,
      statusCode: res.statusCode,
      durationMs: Date.now() - startedAt,
      ip: clientIp(req)
    });
  });

  if (req.method === 'OPTIONS') {
    sendOptions(req, res);
    return;
  }

  if (isRateLimited(req, url.pathname)) {
    sendError(req, res, 429, 'Too many requests');
    return;
  }

  try {
    if (url.pathname === '/admin' || url.pathname.startsWith('/admin/')) {
      serveAdmin(req, res, url.pathname);
      return;
    }

    if (url.pathname.startsWith('/api/admin')) {
      await handleAdminRequest(req, res, url, route);
      return;
    }

    if (route === 'GET /health') {
      sendJson(req, res, 200, {
        ok: true,
        service: 'hailin-backend',
        time: new Date().toISOString(),
        environment: NODE_ENV,
        storageWritable: storageWritable(),
        aiProvider: KIMI_API_KEY ? 'kimi' : 'local',
        aiModel: KIMI_API_KEY ? KIMI_MODEL : undefined,
        adminConfigured: Boolean(ADMIN_TOKEN)
      });
      return;
    }
    if (route === 'GET /api/hailin/home') {
      sendJson(req, res, 200, { data: managedHomePayload() });
      return;
    }
    if (route === 'GET /api/hailin/map-points') {
      sendJson(req, res, 200, { data: mapPoints });
      return;
    }
    if (route === 'GET /api/hailin/foods') {
      sendJson(req, res, 200, { data: foods });
      return;
    }
    if (route === 'GET /api/hailin/lives') {
      sendJson(req, res, 200, { data: livePayload(req) });
      return;
    }
    if (route === 'GET /media/hailin-live.mp4') {
      serveVideo(req, res);
      return;
    }
    if (route === 'GET /api/hailin/bookings') {
      sendError(req, res, 405, 'Method not allowed');
      return;
    }
    if (route === 'GET /api/hailin/feedback') {
      sendError(req, res, 405, 'Method not allowed');
      return;
    }
    if (route === 'POST /api/hailin/bookings') {
      const body = await readBody(req);
      const record = appendRecord('bookings.json', validateBooking(body));
      appendAudit(req, 'booking.created', 'public', record.id, {
        service: record.service,
        date: record.date,
        people: record.people,
        source: record.source
      });
      sendJson(req, res, 201, { data: record, message: '预约已提交' });
      return;
    }
    if (route === 'POST /api/hailin/feedback') {
      const body = await readBody(req);
      const record = appendRecord('feedback.json', validateFeedback(body));
      appendAudit(req, 'feedback.created', 'public', record.id, {
        nickname: record.nickname,
        source: record.source
      });
      sendJson(req, res, 201, { data: record, message: '反馈已提交' });
      return;
    }
    if (route === 'POST /api/hailin/ai-guide') {
      const body = await readBody(req);
      const question = body.message || body.question || '';
      let reply = null;
      let source = 'local';

      try {
        reply = await askKimi(body);
        source = reply ? 'kimi' : 'local';
      } catch (error) {
        logEvent({ level: 'warn', message: 'kimi_request_failed', detail: error.message });
      }

      sendJson(req, res, 200, {
        data: {
          reply: reply || localGuideReply(question),
          source,
          location: LOCATION_TEXT,
          context: REGION_KEYWORDS
        }
      });
      return;
    }

    sendError(req, res, 404, 'Not found');
  } catch (error) {
    const statusCode = error.statusCode || 500;
    sendError(req, res, statusCode, statusCode >= 500 ? 'Internal server error' : error.message, error.detail || (statusCode >= 500 ? error.message : undefined));
  }
}

function bootstrap() {
  validateStartupConfig();
  ensureStorage();
}

function startServer() {
  try {
    bootstrap();
  } catch (error) {
    console.error(`Startup configuration error: ${error.message}`);
    process.exit(1);
  }

  const server = http.createServer(handleRequest);
  server.listen(PORT, HOST, () => {
    console.log(`Hailin backend listening at http://${HOST}:${PORT}`);
    if (!ADMIN_TOKEN) {
      console.warn('ADMIN_TOKEN is not configured; admin API is disabled.');
    }
  });

  function shutdown(signal) {
    console.log(`Received ${signal}, shutting down...`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 5000).unref();
  }

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  return server;
}

if (require.main === module) {
  startServer();
}

module.exports = {
  bootstrap,
  handleRequest,
  startServer
};
