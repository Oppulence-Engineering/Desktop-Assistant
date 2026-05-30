import container from '../di/container.js';
import { IOAuthRepo } from './repo.js';
import * as oauthClient from './oauth-client.js';
import { refreshWorkosTokens } from './workos-backend.js';
import { OAuthTokens } from './types.js';

let refreshInFlight: Promise<OAuthTokens> | null = null;

async function performRefresh(tokens: OAuthTokens): Promise<OAuthTokens> {
    console.log("Refreshing rowboat access token");
    if (!tokens.refresh_token) {
        throw new Error('Rowboat token expired and no refresh token available. Please sign in again.');
    }

    // WorkOS is confidential — refresh is brokered server-side by rowboat-api
    // (which holds the API key). See workos-backend.ts / AUTH.md.
    const refreshed = await refreshWorkosTokens(tokens.refresh_token);

    const oauthRepo = container.resolve<IOAuthRepo>('oauthRepo');
    await oauthRepo.upsert('rowboat', { tokens: refreshed });

    return refreshed;
}

export async function getAccessToken(): Promise<string> {
    const oauthRepo = container.resolve<IOAuthRepo>('oauthRepo');
    const { tokens } = await oauthRepo.read('rowboat');
    if (!tokens) {
        throw new Error('Not signed into Rowboat');
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
