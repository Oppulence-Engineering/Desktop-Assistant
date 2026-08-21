import * as runsCore from '@x/core/runs/runs';
import { bus } from '@x/core/runs/bus';

async function main() {
    const { id } = await runsCore.createRun({
        // this expects an agent file to exist at WorkDir/agents/test-agent.md
        agentId: 'test-agent',
    });
    console.log(`created run: ${id}`);

    await bus.subscribe(id, async (event) => {
        console.log(`got event: ${JSON.stringify(event)}`);
    });

    const msgId = await runsCore.createMessage(id, 'whats your name?');
    console.log(`created message: ${msgId}`);
}

void main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
});
