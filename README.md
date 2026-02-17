# My Secretary

Angular standalone + signals PWA with Android Web Push support.

## What works now

- Daily repeating items (`task` or `medication`) with title, description, and due time.
- Repeating reminders every minute until complete or snoozed (5, 10, 30 min).
- Notification action buttons for complete and snooze.
- Web Push backend scheduler so Android Chrome can notify even when the PWA is closed.

## Project layout

- Frontend: Angular app in `src/`
- Service worker + web assets: `public/`
- Push API + scheduler backend: `server/index.js`

## Prerequisites

- Node.js 20+
- Android phone with Chrome
- HTTPS URL for production deployment

## Setup

1. Install dependencies:
```bash
npm install
```

2. Generate VAPID keys:
```bash
npx web-push generate-vapid-keys
```

3. Start backend with your keys:
```bash
VAPID_PUBLIC_KEY="YOUR_PUBLIC_KEY" \
VAPID_PRIVATE_KEY="YOUR_PRIVATE_KEY" \
VAPID_SUBJECT="mailto:you@example.com" \
npm run server
```

4. Set frontend runtime config in `public/runtime-config.js`:
```js
window.__SECRETARY_CONFIG__ = {
  apiBaseUrl: "http://localhost:8787",
  vapidPublicKey: ""
};
```

5. Start Angular app:
```bash
npm start
```

6. Open `http://localhost:4200`, install as PWA on Android, sign in, create tasks, then tap `Enable notifications`.

## Android behavior

- Closed-PWA notifications require push subscription registration, a continuously running backend, and valid VAPID keys.
- `vapidPublicKey` in runtime config is optional if backend `GET /api/public-config` is reachable.
- If runtime config is missing, the app falls back to local in-tab reminders only.

## API endpoints

- `GET /health`
- `GET /api/public-config`
- `POST /api/register-device`
- `POST /api/sync-tasks`
