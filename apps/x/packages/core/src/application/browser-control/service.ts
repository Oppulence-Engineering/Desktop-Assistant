import type { BrowserControlInput, BrowserControlResult } from '@x/shared/browser-control';

export interface IBrowserControlService {
  execute(
    input: BrowserControlInput,
    ctx?: { signal?: AbortSignal },
  ): Promise<BrowserControlResult>;
}
