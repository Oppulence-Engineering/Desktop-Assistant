import container from '../di/container.js';
import { IOAuthRepo } from './repo.js';
import * as oauthClient from './oauth-client.js';
import { refreshWorkosTokens } from './workos-backend.js';
import { OAuthTokens } from './types.js';
import { PRODUCT_NAME, PRODUCT_PROVIDER_ID } from '@x/shared/dist/branding.js';

let refreshInFlight: Promise<OAuthTokens> | null = null;

async function performRefresh(tokens: OAuthTokens): Promise<OAuthTokens> {
    console.log("Refreshing Solomon AI access token");
    if (!tokens.refresh_token) {
        throw new Error(`${PRODUCT_NAME} token expired and no refresh token available. Please sign in again.`);
    }

    // WorkOS is confidential — refresh is brokered server-side by the API
    // (which holds the API key). See workos-backend.ts / AUTH.md.
    const refreshed = await refreshWorkosTokens(tokens.refresh_token);

    const oauthRepo = container.resolve<IOAuthRepo>('oauthRepo');
    await oauthRepo.upsert(PRODUCT_PROVIDER_ID, { tokens: refreshed });

    return refreshed;
}

export async function getAccessToken(): Promise<string> {
    const oauthRepo = container.resolve<IOAuthRepo>('oauthRepo');
    const { tokens } = await oauthRepo.read(PRODUCT_PROVIDER_ID);
    if (!tokens) {
        throw new Error(`Not signed into ${PRODUCT_NAME}`);
    }

    if (!oauthClient.isTokenExpired(tokens)) {
        return tokens.access_token;
    }

    if (!refreshInFlight) {
        refreshInFlight = performRefresh(tokens).finally(() => {
            refreshInFlight = null;
        });
    }
    const refreshed = await refreshInFlight;
    return refreshed.access_token;
}
