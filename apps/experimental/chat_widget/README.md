# chat_widget

Embeddable end-user chat surface for Rowboat. Built with Next.js 16 (App Router), React 19, NextUI, and Tailwind.

## What it does

Third-party sites embed a single `<script>` that loads `bootstrap.js`. That script:

1. Reads/creates a guest session against the Rowboat API (`/api/widget/v1/session/guest`).
2. Mounts an iframe pointing at this app, which renders the chat UI (`app/app.tsx`).
3. Persists minimized/maximized state in `localStorage` and the session id in a cookie.

The iframe UI talks to the Rowboat backend through `rowboat-shared` (`apiV1` types) for messages, turns, and chat lifecycle.

## Key files

| File | Role |
|------|------|
| `app/page.tsx` → `app/app.tsx` | Chat UI rendered inside the iframe |
| `app/markdown-content.tsx` | Markdown + GFM renderer for assistant messages |
| `app/api/bootstrap.js/route.ts` | Serves the loader script, substituting `__CHAT_WIDGET_HOST__` and `__ROWBOAT_HOST__` |
| `public/bootstrap.template.js` | Loader template (iframe mount, session, postMessage handlers) |

## Environment

| Variable | Required | Purpose |
|----------|----------|---------|
| `CHAT_WIDGET_HOST` | yes | Public origin of this app — interpolated into the loader |
| `ROWBOAT_HOST` | yes | Public origin of the Rowboat API — used as `${ROWBOAT_HOST}/api/widget/v1` |

If `CHAT_WIDGET_HOST` is unset at request time, `/api/bootstrap.js` returns HTTP 500.

## Local dev

```bash
npm install
CHAT_WIDGET_HOST=http://localhost:3001 ROWBOAT_HOST=http://localhost:3000 npm run dev
```

Then on `http://localhost:3001` you can open the chat directly, or embed the loader from another page:

```html
<script>
  window.ROWBOAT_CONFIG = { clientId: '<your-client-id>' };
</script>
<script src="http://localhost:3001/api/bootstrap.js"></script>
```

## Build & Docker

```bash
npm run build           # next build (standalone output)
docker build -t rowboat-chat-widget .
docker run -p 3000:3000 \
  -e CHAT_WIDGET_HOST=https://widget.example.com \
  -e ROWBOAT_HOST=https://rowboat.example.com \
  rowboat-chat-widget
```

The Dockerfile produces a standalone Next server (`node server.js`) on port 3000.
