const express = require('express');
const cors = require('cors');
const webpush = require('web-push');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const PORT = Number(process.env.PORT || 8787);
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || '';
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || '';
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:admin@example.com';
const FRONTEND_DIST_DIR =
  process.env.FRONTEND_DIST_DIR || path.join(__dirname, '..', 'dist', 'my-secretary', 'browser');
const FRONTEND_INDEX_FILE = path.join(FRONTEND_DIST_DIR, 'index.html');
const SERVE_FRONTEND = resolveServeFrontend(FRONTEND_INDEX_FILE);
const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'store.json');
const PUSH_INTERVAL_MS = 30_000;
const PUSH_REPEAT_MS = 60_000;
const AUTH_TOKEN_TTL_MS = readPositiveNumber(process.env.AUTH_TOKEN_TTL_MS, 7 * 24 * 60 * 60 * 1000);
const PASSWORD_MIN_LENGTH = readPositiveNumber(process.env.PASSWORD_MIN_LENGTH, 8);
const DEFAULT_AUTH_SECRET = 'change-this-auth-secret';
const AUTH_SECRET = process.env.AUTH_SECRET || DEFAULT_AUTH_SECRET;

if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
}

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));
if (SERVE_FRONTEND) {
  app.use(
    express.static(FRONTEND_DIST_DIR, {
      index: false
    })
  );
}

app.get('/health', (_req, res) => {
  const store = readStore();
  res.json({
    ok: true,
    pushConfigured: Boolean(VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY),
    authConfigured: AUTH_SECRET !== DEFAULT_AUTH_SECRET,
    schedulerLastRunAt: store.meta.lastSchedulerRunAt
  });
});

app.get('/api/public-config', (_req, res) => {
  res.json({
    vapidPublicKey: VAPID_PUBLIC_KEY
  });
});

app.post('/api/auth/register', (req, res) => {
  const userName = normalizeUserName(req.body?.userName);
  const password = normalizePassword(req.body?.password);
  if (!isValidCredentials(userName, password)) {
    res.status(400).json({ ok: false, error: invalidCredentialsMessage() });
    return;
  }
  const store = readStore();
  const user = store.users[userName];
  if (user?.auth.passwordHash && user.auth.passwordSalt) {
    res.status(409).json({ ok: false, error: 'User already exists. Sign in instead.' });
    return;
  }
  const authRecord = buildAuthRecord(password);
  if (user) {
    user.auth = authRecord;
  } else {
    store.users[userName] = createEmptyUser(authRecord);
  }
  writeStore(store);
  const session = issueSession(userName);
  res.json({
    ok: true,
    userName,
    token: session.token,
    expiresAt: session.expiresAt
  });
});

app.post('/api/auth/login', (req, res) => {
  const userName = normalizeUserName(req.body?.userName);
  const password = normalizePassword(req.body?.password);
  if (!isValidCredentials(userName, password)) {
    res.status(400).json({ ok: false, error: invalidCredentialsMessage() });
    return;
  }
  const store = readStore();
  const user = store.users[userName];
  if (!user || !user.auth.passwordHash || !user.auth.passwordSalt) {
    res.status(401).json({ ok: false, error: 'Invalid username or password.' });
    return;
  }
  if (!verifyPassword(password, user.auth.passwordSalt, user.auth.passwordHash)) {
    res.status(401).json({ ok: false, error: 'Invalid username or password.' });
    return;
  }
  const session = issueSession(userName);
  res.json({
    ok: true,
    userName,
    token: session.token,
    expiresAt: session.expiresAt
  });
});

app.get('/api/tasks', requireAuth, (req, res) => {
  const store = readStore();
  const user = getOrCreateUser(store, req.authUserName);
  res.json({
    ok: true,
    tasks: user.tasks
  });
});

app.get('/api/diagnostics', requireAuth, (req, res) => {
  const store = readStore();
  const user = getOrCreateUser(store, req.authUserName);
  res.json({
    ok: true,
    pushConfigured: Boolean(VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY),
    schedulerLastRunAt: store.meta.lastSchedulerRunAt,
    deviceCount: user.devices.length,
    taskCount: user.tasks.length,
    metrics: user.metrics
  });
});

app.post('/api/register-device', requireAuth, (req, res) => {
  const subscription = req.body?.subscription;
  if (!subscription?.endpoint) {
    res.status(400).json({ ok: false, error: 'Invalid registration payload' });
    return;
  }
  const store = readStore();
  const user = getOrCreateUser(store, req.authUserName);
  const existingIndex = user.devices.findIndex((device) => device.endpoint === subscription.endpoint);
  if (existingIndex >= 0) {
    user.devices[existingIndex] = subscription;
  } else {
    user.devices.push(subscription);
  }
  const nowIso = new Date().toISOString();
  user.metrics.lastDeviceRegisterAt = nowIso;
  user.metrics.lastDeviceCount = user.devices.length;
  writeStore(store);
  res.json({ ok: true, deviceCount: user.devices.length });
});

app.post('/api/sync-tasks', requireAuth, (req, res) => {
  const tasks = normalizeTasks(req.body?.tasks);
  const nowIso = new Date().toISOString();
  const store = readStore();
  const user = getOrCreateUser(store, req.authUserName);
  user.tasks = tasks;
  pruneTaskPushState(user);
  user.metrics.lastSyncAt = nowIso;
  user.metrics.lastSyncTaskCount = user.tasks.length;
  writeStore(store);
  res.json({ ok: true, taskCount: user.tasks.length });
});

if (SERVE_FRONTEND) {
  app.get(/^(?!\/api(?:\/|$)|\/health$).*/, (_req, res) => {
    res.sendFile(FRONTEND_INDEX_FILE);
  });
}

app.listen(PORT, () => {
  console.log(`My Secretary push server listening on http://localhost:${PORT}`);
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    console.log('Set VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY to enable push delivery.');
  }
  if (AUTH_SECRET === DEFAULT_AUTH_SECRET) {
    console.log('Set AUTH_SECRET to secure backend authentication tokens.');
  }
  if (SERVE_FRONTEND) {
    console.log(`Serving frontend bundle from ${FRONTEND_DIST_DIR}`);
  }
});

setInterval(() => {
  void runPushScheduler();
}, PUSH_INTERVAL_MS);

async function runPushScheduler() {
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    return;
  }
  const snapshot = readStore();
  const now = new Date();
  const nowIso = now.toISOString();
  const mergedUpdates = {
    lastSchedulerRunAt: nowIso,
    users: {}
  };

  for (const userName of Object.keys(snapshot.users)) {
    const user = snapshot.users[userName];
    const userUpdate = createUserSchedulerUpdate();
    let dueCount = 0;

    for (const task of user.tasks) {
      if (!isTaskDue(task, now)) {
        continue;
      }
      dueCount += 1;
      if (pushedRecently(user.lastPushByTask[task.id], now, PUSH_REPEAT_MS)) {
        continue;
      }
      userUpdate.metrics.lastPushAttemptAt = nowIso;
      const payload = JSON.stringify({
        taskId: task.id,
        title: task.title,
        body: task.description || `Daily ${task.kind} due now (${task.schedule.time}).`,
        tag: `my-secretary-${task.id}`
      });

      const stillActiveDevices = [];
      let sentToAnyDevice = false;
      let firstErrorMessage = '';

      for (const subscription of user.devices) {
        try {
          await webpush.sendNotification(subscription, payload);
          stillActiveDevices.push(subscription);
          sentToAnyDevice = true;
        } catch (error) {
          if (!isGoneSubscriptionError(error)) {
            stillActiveDevices.push(subscription);
            if (!firstErrorMessage) {
              firstErrorMessage = toErrorMessage(error);
            }
          }
        }
      }

      if (stillActiveDevices.length !== user.devices.length) {
        userUpdate.devices = stillActiveDevices;
        userUpdate.metrics.lastDeviceCount = stillActiveDevices.length;
      }

      if (sentToAnyDevice) {
        userUpdate.lastPushByTask[task.id] = nowIso;
        userUpdate.metrics.lastPushSuccessAt = nowIso;
        userUpdate.metrics.lastPushFailureAt = null;
        userUpdate.metrics.lastPushFailureMessage = null;
        userUpdate.metrics.lastPushedTaskId = task.id;
      } else if (firstErrorMessage) {
        userUpdate.metrics.lastPushFailureAt = nowIso;
        userUpdate.metrics.lastPushFailureMessage = firstErrorMessage;
      }
    }

    if (dueCount > 0) {
      userUpdate.metrics.lastSchedulerDueAt = nowIso;
      userUpdate.metrics.lastSchedulerDueCount = dueCount;
    }

    if (hasSchedulerUserUpdate(userUpdate)) {
      mergedUpdates.users[userName] = userUpdate;
    }
  }

  persistSchedulerUpdates(mergedUpdates);
}

function normalizeUserName(userName) {
  if (typeof userName !== 'string') {
    return '';
  }
  return userName.trim().toLowerCase();
}

function normalizePassword(password) {
  if (typeof password !== 'string') {
    return '';
  }
  return password;
}

function isValidCredentials(userName, password) {
  if (!userName || userName.length > 40) {
    return false;
  }
  if (password.length < PASSWORD_MIN_LENGTH || password.length > 200) {
    return false;
  }
  return true;
}

function invalidCredentialsMessage() {
  return `Username is required (max 40 chars), password must be at least ${PASSWORD_MIN_LENGTH} chars.`;
}

function normalizeTasks(input) {
  if (!Array.isArray(input)) {
    return [];
  }
  return input
    .filter((task) => task && typeof task.id === 'string' && typeof task.title === 'string')
    .map((task) => ({
      id: task.id,
      kind: task.kind === 'medication' ? 'medication' : 'task',
      title: String(task.title).trim(),
      description: typeof task.description === 'string' ? task.description : '',
      schedule: {
        type: 'daily',
        time: typeof task.schedule?.time === 'string' ? task.schedule.time : '09:00'
      },
      state: {
        lastCompletedDate:
          typeof task.state?.lastCompletedDate === 'string' ? task.state.lastCompletedDate : null,
        snoozedUntil: typeof task.state?.snoozedUntil === 'string' ? task.state.snoozedUntil : null,
        lastAlertedAt: typeof task.state?.lastAlertedAt === 'string' ? task.state.lastAlertedAt : null
      }
    }));
}

function isTaskDue(task, now) {
  const today = toDayKey(now);
  if (task.state.lastCompletedDate === today) {
    return false;
  }
  const dueDate = toDueDate(task.schedule.time, now);
  if (now.getTime() < dueDate.getTime()) {
    return false;
  }
  if (task.state.snoozedUntil) {
    const snoozedUntil = new Date(task.state.snoozedUntil);
    if (now.getTime() < snoozedUntil.getTime()) {
      return false;
    }
  }
  return true;
}

function pushedRecently(lastPushedAt, now, intervalMs) {
  if (!lastPushedAt) {
    return false;
  }
  return now.getTime() - new Date(lastPushedAt).getTime() < intervalMs;
}

function pruneTaskPushState(user) {
  const taskIds = new Set(user.tasks.map((task) => task.id));
  for (const taskId of Object.keys(user.lastPushByTask)) {
    if (!taskIds.has(taskId)) {
      delete user.lastPushByTask[taskId];
    }
  }
}

function toDayKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate()
  ).padStart(2, '0')}`;
}

function toDueDate(time, now) {
  const [hours, minutes] = String(time).split(':').map(Number);
  return new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    Number.isFinite(hours) ? hours : 0,
    Number.isFinite(minutes) ? minutes : 0,
    0,
    0
  );
}

function isGoneSubscriptionError(error) {
  if (!error || typeof error !== 'object') {
    return false;
  }
  const statusCode = error.statusCode;
  return statusCode === 404 || statusCode === 410;
}

function toErrorMessage(error) {
  if (!error || typeof error !== 'object') {
    return 'Unknown push error';
  }
  if (typeof error.body === 'string' && error.body.trim()) {
    return error.body.slice(0, 300);
  }
  if (typeof error.message === 'string' && error.message.trim()) {
    return error.message.slice(0, 300);
  }
  return 'Unknown push error';
}

function createMetrics() {
  return {
    lastSyncAt: null,
    lastSyncTaskCount: 0,
    lastDeviceRegisterAt: null,
    lastDeviceCount: 0,
    lastPushAttemptAt: null,
    lastPushSuccessAt: null,
    lastPushFailureAt: null,
    lastPushFailureMessage: null,
    lastPushedTaskId: null,
    lastSchedulerDueAt: null,
    lastSchedulerDueCount: 0
  };
}

function normalizeMetrics(input) {
  const defaults = createMetrics();
  if (!input || typeof input !== 'object') {
    return defaults;
  }
  return {
    ...defaults,
    lastSyncAt: typeof input.lastSyncAt === 'string' ? input.lastSyncAt : defaults.lastSyncAt,
    lastSyncTaskCount: Number.isFinite(input.lastSyncTaskCount)
      ? Number(input.lastSyncTaskCount)
      : defaults.lastSyncTaskCount,
    lastDeviceRegisterAt:
      typeof input.lastDeviceRegisterAt === 'string'
        ? input.lastDeviceRegisterAt
        : defaults.lastDeviceRegisterAt,
    lastDeviceCount: Number.isFinite(input.lastDeviceCount)
      ? Number(input.lastDeviceCount)
      : defaults.lastDeviceCount,
    lastPushAttemptAt:
      typeof input.lastPushAttemptAt === 'string' ? input.lastPushAttemptAt : defaults.lastPushAttemptAt,
    lastPushSuccessAt:
      typeof input.lastPushSuccessAt === 'string' ? input.lastPushSuccessAt : defaults.lastPushSuccessAt,
    lastPushFailureAt:
      typeof input.lastPushFailureAt === 'string' ? input.lastPushFailureAt : defaults.lastPushFailureAt,
    lastPushFailureMessage:
      typeof input.lastPushFailureMessage === 'string'
        ? input.lastPushFailureMessage
        : defaults.lastPushFailureMessage,
    lastPushedTaskId:
      typeof input.lastPushedTaskId === 'string' ? input.lastPushedTaskId : defaults.lastPushedTaskId,
    lastSchedulerDueAt:
      typeof input.lastSchedulerDueAt === 'string' ? input.lastSchedulerDueAt : defaults.lastSchedulerDueAt,
    lastSchedulerDueCount: Number.isFinite(input.lastSchedulerDueCount)
      ? Number(input.lastSchedulerDueCount)
      : defaults.lastSchedulerDueCount
  };
}

function createEmptyUser(authRecord = createEmptyAuthRecord()) {
  return {
    auth: authRecord,
    devices: [],
    tasks: [],
    lastPushByTask: {},
    metrics: createMetrics()
  };
}

function createEmptyAuthRecord() {
  return {
    passwordHash: '',
    passwordSalt: '',
    createdAt: null,
    updatedAt: null
  };
}

function normalizeStore(store) {
  const normalized = {
    meta: {
      lastSchedulerRunAt:
        typeof store?.meta?.lastSchedulerRunAt === 'string' ? store.meta.lastSchedulerRunAt : null
    },
    users: {}
  };

  if (!store?.users || typeof store.users !== 'object') {
    return normalized;
  }

  for (const [rawUserName, rawUser] of Object.entries(store.users)) {
    const userName = normalizeUserName(rawUserName);
    if (!userName || !rawUser || typeof rawUser !== 'object') {
      continue;
    }
    const devices = Array.isArray(rawUser.devices)
      ? rawUser.devices.filter((device) => device && typeof device.endpoint === 'string')
      : [];
    const auth = {
      passwordHash: typeof rawUser.auth?.passwordHash === 'string' ? rawUser.auth.passwordHash : '',
      passwordSalt: typeof rawUser.auth?.passwordSalt === 'string' ? rawUser.auth.passwordSalt : '',
      createdAt: typeof rawUser.auth?.createdAt === 'string' ? rawUser.auth.createdAt : null,
      updatedAt: typeof rawUser.auth?.updatedAt === 'string' ? rawUser.auth.updatedAt : null
    };
    const lastPushByTask = {};
    if (rawUser.lastPushByTask && typeof rawUser.lastPushByTask === 'object') {
      for (const [taskId, lastPushedAt] of Object.entries(rawUser.lastPushByTask)) {
        if (typeof taskId === 'string' && typeof lastPushedAt === 'string') {
          lastPushByTask[taskId] = lastPushedAt;
        }
      }
    }
    normalized.users[userName] = {
      auth,
      devices,
      tasks: normalizeTasks(rawUser.tasks),
      lastPushByTask,
      metrics: normalizeMetrics(rawUser.metrics)
    };
  }

  return normalized;
}

function getOrCreateUser(store, userName) {
  if (!store.users[userName]) {
    store.users[userName] = createEmptyUser();
  }
  return store.users[userName];
}

function readStore() {
  ensureStoreFile();
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return normalizeStore(parsed);
  } catch {
    return normalizeStore({});
  }
}

function writeStore(store) {
  ensureStoreFile();
  const tempFile = `${DATA_FILE}.tmp`;
  fs.writeFileSync(tempFile, JSON.stringify(normalizeStore(store), null, 2));
  fs.renameSync(tempFile, DATA_FILE);
}

function ensureStoreFile() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(DATA_FILE)) {
    const initialValue = normalizeStore({});
    fs.writeFileSync(DATA_FILE, JSON.stringify(initialValue, null, 2));
  }
}

function resolveServeFrontend(frontendIndexFile) {
  const explicit = process.env.SERVE_FRONTEND?.trim().toLowerCase();
  if (explicit === 'true') {
    return true;
  }
  if (explicit === 'false') {
    return false;
  }
  return fs.existsSync(frontendIndexFile);
}

function readPositiveNumber(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

function buildAuthRecord(password) {
  const salt = crypto.randomBytes(16).toString('base64url');
  const passwordHash = hashPassword(password, salt);
  const nowIso = new Date().toISOString();
  return {
    passwordHash,
    passwordSalt: salt,
    createdAt: nowIso,
    updatedAt: nowIso
  };
}

function hashPassword(password, salt) {
  return crypto.pbkdf2Sync(password, salt, 120000, 32, 'sha256').toString('base64url');
}

function verifyPassword(password, salt, expectedHash) {
  const actualHash = hashPassword(password, salt);
  const expectedBuffer = Buffer.from(expectedHash);
  const actualBuffer = Buffer.from(actualHash);
  if (expectedBuffer.length !== actualBuffer.length) {
    return false;
  }
  return crypto.timingSafeEqual(expectedBuffer, actualBuffer);
}

function issueSession(userName) {
  const expiresAt = new Date(Date.now() + AUTH_TOKEN_TTL_MS).toISOString();
  const payload = {
    sub: userName,
    exp: expiresAt
  };
  const payloadSegment = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const signature = signTokenSegment(payloadSegment);
  return {
    token: `${payloadSegment}.${signature}`,
    expiresAt
  };
}

function signTokenSegment(payloadSegment) {
  return crypto.createHmac('sha256', AUTH_SECRET).update(payloadSegment).digest('base64url');
}

function verifySessionToken(token) {
  if (!token || typeof token !== 'string') {
    return null;
  }
  const [payloadSegment, signature] = token.split('.');
  if (!payloadSegment || !signature) {
    return null;
  }
  const expectedSignature = signTokenSegment(payloadSegment);
  const signatureBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expectedSignature);
  if (signatureBuffer.length !== expectedBuffer.length) {
    return null;
  }
  if (!crypto.timingSafeEqual(signatureBuffer, expectedBuffer)) {
    return null;
  }
  try {
    const payload = JSON.parse(Buffer.from(payloadSegment, 'base64url').toString('utf8'));
    const userName = normalizeUserName(payload?.sub);
    const expiresAt = typeof payload?.exp === 'string' ? new Date(payload.exp) : null;
    if (!userName || !expiresAt || Number.isNaN(expiresAt.getTime())) {
      return null;
    }
    if (Date.now() >= expiresAt.getTime()) {
      return null;
    }
    return userName;
  } catch {
    return null;
  }
}

function requireAuth(req, res, next) {
  const token = readBearerToken(req.headers.authorization);
  const userName = verifySessionToken(token);
  if (!userName) {
    res.status(401).json({ ok: false, error: 'Unauthorized' });
    return;
  }
  req.authUserName = userName;
  next();
}

function readBearerToken(authorizationHeader) {
  if (typeof authorizationHeader !== 'string') {
    return '';
  }
  const [scheme, value] = authorizationHeader.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !value) {
    return '';
  }
  return value;
}

function createUserSchedulerUpdate() {
  return {
    devices: null,
    lastPushByTask: {},
    metrics: {
      lastPushAttemptAt: null,
      lastPushSuccessAt: null,
      lastPushFailureAt: null,
      lastPushFailureMessage: null,
      lastPushedTaskId: null,
      lastDeviceCount: null,
      lastSchedulerDueAt: null,
      lastSchedulerDueCount: null
    }
  };
}

function hasSchedulerUserUpdate(update) {
  if (update.devices !== null) {
    return true;
  }
  if (Object.keys(update.lastPushByTask).length > 0) {
    return true;
  }
  for (const value of Object.values(update.metrics)) {
    if (value !== null) {
      return true;
    }
  }
  return false;
}

function persistSchedulerUpdates(updates) {
  const store = readStore();
  store.meta.lastSchedulerRunAt = updates.lastSchedulerRunAt;
  for (const [userName, update] of Object.entries(updates.users)) {
    const user = getOrCreateUser(store, userName);
    if (update.devices !== null) {
      user.devices = update.devices;
    }
    user.lastPushByTask = {
      ...user.lastPushByTask,
      ...update.lastPushByTask
    };
    if (update.metrics.lastPushAttemptAt !== null) {
      user.metrics.lastPushAttemptAt = update.metrics.lastPushAttemptAt;
    }
    if (update.metrics.lastPushSuccessAt !== null) {
      user.metrics.lastPushSuccessAt = update.metrics.lastPushSuccessAt;
    }
    if (update.metrics.lastPushFailureAt !== null) {
      user.metrics.lastPushFailureAt = update.metrics.lastPushFailureAt;
    }
    if (update.metrics.lastPushFailureMessage !== null) {
      user.metrics.lastPushFailureMessage = update.metrics.lastPushFailureMessage;
    }
    if (update.metrics.lastPushFailureAt === null && update.metrics.lastPushSuccessAt !== null) {
      user.metrics.lastPushFailureMessage = null;
      user.metrics.lastPushFailureAt = null;
    }
    if (update.metrics.lastPushedTaskId !== null) {
      user.metrics.lastPushedTaskId = update.metrics.lastPushedTaskId;
    }
    if (update.metrics.lastDeviceCount !== null) {
      user.metrics.lastDeviceCount = update.metrics.lastDeviceCount;
    }
    if (update.metrics.lastSchedulerDueAt !== null) {
      user.metrics.lastSchedulerDueAt = update.metrics.lastSchedulerDueAt;
    }
    if (update.metrics.lastSchedulerDueCount !== null) {
      user.metrics.lastSchedulerDueCount = update.metrics.lastSchedulerDueCount;
    }
  }
  writeStore(store);
}
