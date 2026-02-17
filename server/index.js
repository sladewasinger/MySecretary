const express = require('express');
const cors = require('cors');
const webpush = require('web-push');
const fs = require('node:fs');
const path = require('node:path');

const PORT = Number(process.env.PORT || 8787);
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || '';
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || '';
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:admin@example.com';
const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'store.json');
const PUSH_INTERVAL_MS = 30_000;
const PUSH_REPEAT_MS = 60_000;

if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
}

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));

app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    pushConfigured: Boolean(VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY)
  });
});

app.get('/api/public-config', (_req, res) => {
  res.json({
    vapidPublicKey: VAPID_PUBLIC_KEY
  });
});

app.post('/api/register-device', (req, res) => {
  const userName = normalizeUserName(req.body?.userName);
  const subscription = req.body?.subscription;
  if (!userName || !subscription?.endpoint) {
    res.status(400).json({ ok: false, error: 'Invalid registration payload' });
    return;
  }
  const store = readStore();
  const user = getOrCreateUser(store, userName);
  const existing = user.devices.find((device) => device.endpoint === subscription.endpoint);
  if (!existing) {
    user.devices.push(subscription);
    writeStore(store);
  }
  res.json({ ok: true });
});

app.post('/api/sync-tasks', (req, res) => {
  const userName = normalizeUserName(req.body?.userName);
  const tasks = normalizeTasks(req.body?.tasks);
  if (!userName) {
    res.status(400).json({ ok: false, error: 'Missing userName' });
    return;
  }
  const store = readStore();
  const user = getOrCreateUser(store, userName);
  user.tasks = tasks;
  pruneTaskPushState(user);
  writeStore(store);
  res.json({ ok: true, taskCount: user.tasks.length });
});

app.listen(PORT, () => {
  console.log(`My Secretary push server listening on http://localhost:${PORT}`);
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    console.log('Set VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY to enable push delivery.');
  }
});

setInterval(() => {
  void runPushScheduler();
}, PUSH_INTERVAL_MS);

async function runPushScheduler() {
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    return;
  }
  const store = readStore();
  const now = new Date();
  let changed = false;
  for (const userName of Object.keys(store.users)) {
    const user = store.users[userName];
    for (const task of user.tasks) {
      if (!isTaskDue(task, now)) {
        continue;
      }
      if (pushedRecently(user.lastPushByTask[task.id], now, PUSH_REPEAT_MS)) {
        continue;
      }
      const payload = JSON.stringify({
        taskId: task.id,
        title: task.title,
        body: task.description || `Daily ${task.kind} due now (${task.schedule.time}).`,
        tag: `my-secretary-${task.id}`
      });
      const stillActiveDevices = [];
      let sentToAnyDevice = false;
      for (const subscription of user.devices) {
        try {
          await webpush.sendNotification(subscription, payload);
          stillActiveDevices.push(subscription);
          sentToAnyDevice = true;
        } catch (error) {
          if (!isGoneSubscriptionError(error)) {
            stillActiveDevices.push(subscription);
          }
        }
      }
      if (stillActiveDevices.length !== user.devices.length) {
        user.devices = stillActiveDevices;
        changed = true;
      }
      if (sentToAnyDevice) {
        user.lastPushByTask[task.id] = now.toISOString();
        changed = true;
      }
    }
  }
  if (changed) {
    writeStore(store);
  }
}

function normalizeUserName(userName) {
  if (typeof userName !== 'string') {
    return '';
  }
  return userName.trim().toLowerCase();
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
        snoozedUntil: typeof task.state?.snoozedUntil === 'string' ? task.state.snoozedUntil : null
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

function getOrCreateUser(store, userName) {
  if (!store.users[userName]) {
    store.users[userName] = {
      devices: [],
      tasks: [],
      lastPushByTask: {}
    };
  }
  return store.users[userName];
}

function readStore() {
  ensureStoreFile();
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed.users || typeof parsed.users !== 'object') {
      return { users: {} };
    }
    return parsed;
  } catch {
    return { users: {} };
  }
}

function writeStore(store) {
  ensureStoreFile();
  fs.writeFileSync(DATA_FILE, JSON.stringify(store, null, 2));
}

function ensureStoreFile() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify({ users: {} }, null, 2));
  }
}
