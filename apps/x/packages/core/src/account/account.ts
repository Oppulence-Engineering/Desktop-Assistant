import container from '../di/container.js';
import { IOAuthRepo } from '../auth/repo.js';
import { PRODUCT_PROVIDER_ID } from '@x/shared/branding';

export async function isSignedIn(): Promise<boolean> {
    const oauthRepo = container.resolve<IOAuthRepo>('oauthRepo');
    const { tokens } = await oauthRepo.read(PRODUCT_PROVIDER_ID);
    return !!tokens;
}
