# tools_webhook

Reference Flask service that Rowboat workflows can POST to in order to execute tool functions out-of-process. Useful as a template for integrating custom code, business logic, or third-party APIs as Rowboat tools.

## What it does

Exposes a single endpoint:

```
POST /tool_call
```

The request body is the standard Rowboat tool-call envelope. The handler:

1. Optionally verifies the request signature (see below).
2. Parses `content` (a JSON string) and pulls `toolCall.function.name` + `toolCall.function.arguments`.
3. Looks up the function in `FUNCTIONS_MAP` (`function_map.py`) and dispatches via `call_tool` (`tool_caller.py`), which:
   - validates required and unexpected parameters against the function signature,
   - coerces values using each parameter's type annotation,
   - invokes the function and returns the result.
4. Responds with `{"result": ...}` (200), `{"error": ...}` (400) for validation failures, or 500 for unexpected exceptions.

The bundled functions (`greet`, `add`, `get_account_balance`) are placeholders — replace `FUNCTIONS_MAP` with your own.

## Request signing

If `SIGNING_SECRET` is set, every request must carry an `X-Signature-Jwt` header containing an HS256 JWT signed with that secret. The JWT must include a `bodyHash` claim equal to `sha256(content)` (hex). Mismatches return 403; missing/invalid tokens return 401. If `SIGNING_SECRET` is unset, signature verification is skipped — fine for local dev, not for production.

## Key files

| File | Role |
|------|------|
| `app.py` | Flask app, `require_signed_request` decorator, `/tool_call` route |
| `function_map.py` | `FUNCTIONS_MAP` registry — add your tool functions here |
| `tool_caller.py` | Generic dispatcher: signature inspection, type coercion, invocation |
| `tests/` | pytest tests for the route and dispatcher |

## Environment

| Variable | Required | Purpose |
|----------|----------|---------|
| `SIGNING_SECRET` | optional | HS256 secret for `X-Signature-Jwt` verification. If unset, requests are accepted without a signature. |
| `FLASK_APP` | yes (Docker) | Set to `app` so `flask run` finds the module |

## Local dev

```bash
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
FLASK_APP=app flask run --port 3005
```

Test call (unsigned):

```bash
curl -X POST http://localhost:3005/tool_call \
  -H 'Content-Type: application/json' \
  -d '{"content":"{\"toolCall\":{\"function\":{\"name\":\"add\",\"arguments\":\"{\\\"a\\\":2,\\\"b\\\":3}\"}}}"}'
# -> {"result":5}
```

## Tests

```bash
pytest tests/
```

## Docker

```bash
docker build -t rowboat-tools-webhook .
docker run -p 3005:3005 \
  -e SIGNING_SECRET=my-shared-secret \
  rowboat-tools-webhook
```
