# experimental

Stand-alone services that orbit the main Rowboat platform. Each one runs on its own and is not part of the core `apps/rowboat` Next.js build.

| App | Stack | Purpose |
|-----|-------|---------|
| [`chat_widget`](./chat_widget) | Next.js 16 + React 19 | Embeddable end-user chat surface. Serves the iframe UI and a `bootstrap.js` loader that sites drop into their page. |
| [`simulation_runner`](./simulation_runner) | Python 3.11 + MongoDB + OpenAI | Async worker that picks up pending `test_runs` from Mongo, role-plays the user against a Rowboat workflow, and writes pass/fail verdicts back. |
| [`tools_webhook`](./tools_webhook) | Python 3.11 + Flask | Reference HTTP webhook that Rowboat workflows can call to execute tool functions. Includes optional HS256 JWT request signing. |

Each directory has its own `Dockerfile` and `README.md` with run instructions.
