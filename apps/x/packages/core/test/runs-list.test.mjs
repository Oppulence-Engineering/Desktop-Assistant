import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

function startEvent(runId, agentName) {
  return JSON.stringify({
    type: 'start',
    runId,
    subflow: [],
    agentName,
    model: 'test-model',
    provider: 'test-provider',
    useCase: 'copilot_chat',
    ts: '2026-05-21T00:00:00.000Z',
  });
}

function userMessage(runId, content) {
  return JSON.stringify({
    type: 'message',
    runId,
    subflow: [],
    messageId: `${runId}-message`,
    message: {
      role: 'user',
      content,
    },
    ts: '2026-05-21T00:01:00.000Z',
  });
}

async function writeRun(workDir, runId, agentName, title) {
  await writeFile(
    path.join(workDir, 'runs', `${runId}.jsonl`),
    `${startEvent(runId, agentName)}\n${userMessage(runId, title)}\n`,
    'utf8',
  );
}

test('FSRunsRepo.list returns bounded filtered pages without skipping older matching runs', async () => {
  const workDir = await mkdtemp(path.join(os.tmpdir(), 'rowboat-runs-list-'));
  process.env.ROWBOAT_WORKDIR = workDir;

  try {
    await mkdir(path.join(workDir, 'runs'), { recursive: true });

    await writeRun(workDir, '006', 'background-agent', 'ignore newest background run');
    await writeRun(workDir, '005', 'copilot', 'first copilot run');
    await writeRun(workDir, '004', 'copilot', 'second copilot run');
    await writeRun(workDir, '003', 'background-agent', 'ignore middle background run');
    await writeRun(workDir, '002', 'copilot', 'third copilot run');
    await writeRun(workDir, '001', 'copilot', 'fourth copilot run');

    const { FSRunsRepo } = await import('../dist/runs/repo.js');
    const repo = new FSRunsRepo({
      idGenerator: {
        next: async () => 'unused',
      },
    });

    const firstPage = await repo.list({ limit: 2, agentId: 'copilot' });

    assert.deepEqual(firstPage.runs.map((run) => run.id), ['005', '004']);
    assert.equal(firstPage.nextCursor, '004.jsonl');

    const secondPage = await repo.list({
      cursor: firstPage.nextCursor,
      limit: 2,
      agentId: 'copilot',
    });

    assert.deepEqual(secondPage.runs.map((run) => run.id), ['002', '001']);
    assert.equal(secondPage.nextCursor, undefined);
  } finally {
    await rm(workDir, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    });
    delete process.env.ROWBOAT_WORKDIR;
  }
});
