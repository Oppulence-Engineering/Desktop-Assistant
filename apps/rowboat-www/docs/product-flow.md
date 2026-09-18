# Product auth and BFF flow

```mermaid
sequenceDiagram
  participant Browser
  participant WWW as rowboat-www (Next.js BFF)
  participant API as rowboat-api (Go)
  participant WorkOS

  Browser->>WWW: GET /app/report
  WWW->>WWW: proxy.ts checks sealed session cookie
  alt no session
    WWW-->>Browser: 302 /api/auth/workos/login
    Browser->>WWW: login route (PKCE)
    WWW->>API: POST /v1/auth/workos/login-url
    API-->>WWW: WorkOS authorize URL
    Browser->>WorkOS: OAuth
    WorkOS-->>Browser: callback ?code=
    Browser->>WWW: /api/auth/workos/callback
    WWW->>API: POST /v1/auth/workos/exchange
    API-->>WWW: token bundle
    WWW->>WWW: seal session cookie (AES-GCM)
  end
  Browser->>WWW: fetch /api/rowboat/v1/revenue-leak-scans
  WWW->>WWW: refresh session if needed
  WWW->>API: Bearer access token
  API-->>WWW: JSON
  WWW-->>Browser: JSON (tokens never exposed)
```

## Rules

- Browser code calls **same-origin** `/api/rowboat/v1/...` only.
- Access tokens live in **HTTP-only sealed cookies**, never `localStorage`.
- `rowboat-api` is the authority for authorization; the BFF attaches credentials.

## Local development

```bash
npm run dev:stack   # validates env, checks API healthz, hot reload on :18082
open http://localhost:18082/dev/routes
```
