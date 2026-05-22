# simulation_runner

Async Python worker that executes Rowboat test runs against a workflow and writes verdicts back to MongoDB.

## What it does

`JobService` (`service.py`) polls the `test_runs` collection for `status: "pending"` rows. For each one it:

1. Atomically claims the run (`pending` → `running`) via `find_one_and_update`.
2. Loads the run's `TestSimulation`s and the API key for the `projectId`.
3. For each simulation, calls `simulate_simulation` (`simulation.py`):
   - Uses OpenAI (`gpt-4.1`) to role-play a customer against the Rowboat workflow using `StatefulChat`.
   - Runs up to `max_iterations` turns (default 5).
   - Evaluates the transcript against `passCriteria` with a JSON-mode call.
   - Persists a `TestResult` (verdict, details, transcript) per simulation.
4. Writes `AggregateResults` and flips the run to `completed`.

A background heartbeat task updates `lastHeartbeat` every 10s. A second background task marks runs `failed` if their heartbeat is older than 20 minutes (`mark_stale_jobs_as_failed`). Concurrency is capped at 5 runs via `asyncio.Semaphore`.

## Data model

Defined in `scenario_types.py` (pydantic):

| Collection | Type |
|------------|------|
| `test_scenarios` | `TestScenario` |
| `test_simulations` | `TestSimulation` |
| `test_runs` | `TestRun` (statuses: pending / running / completed / cancelled / failed / error) |
| `test_results` | `TestResult` |
| `api_keys` | per-project API key lookup |

## Key files

| File | Role |
|------|------|
| `service.py` | `JobService` — poll loop, heartbeat, stale-run sweeper, entry point |
| `simulation.py` | OpenAI-driven role-play + verdict evaluation |
| `db.py` | Mongo access layer (`MONGODB_URI` connection, run/simulation/result helpers) |
| `scenario_types.py` | Pydantic models for runs, simulations, results |

## Environment

| Variable | Default | Purpose |
|----------|---------|---------|
| `MONGODB_URI` | `mongodb://localhost:27017/rowboat` | Mongo connection string |
| `ROWBOAT_API_HOST` | `http://127.0.0.1:3000` | Rowboat backend used by the `rowboat` Python client |
| `OPENAI_API_KEY` | — | Required by the `openai` SDK for both role-play and evaluation calls |

## Local dev

```bash
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
export OPENAI_API_KEY=sk-...
export MONGODB_URI=mongodb://localhost:27017/rowboat
python service.py
```

The service will idle on a 5-second poll until a `test_runs` document appears in `pending` state.

## Docker

```bash
docker build -t rowboat-simulation-runner .
docker run \
  -e OPENAI_API_KEY=sk-... \
  -e MONGODB_URI=mongodb://host.docker.internal:27017/rowboat \
  -e ROWBOAT_API_HOST=http://host.docker.internal:3000 \
  rowboat-simulation-runner
```
