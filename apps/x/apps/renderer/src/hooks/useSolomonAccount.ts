import { z } from "zod";
import { useCallback, useEffect, useState } from "react";
import { SolomonApiConfig } from "@x/shared/dist/solomon-account.js";
import { PRODUCT_PROVIDER_ID } from "@x/shared/dist/branding.js";

interface SolomonAccountState {
  signedIn: boolean;
  accessToken: string | null;
  config: z.infer<typeof SolomonApiConfig> | null;
}

export type SolomonAccountSnapshot = SolomonAccountState;

const DEFAULT_STATE: SolomonAccountState = {
  signedIn: false,
  accessToken: null,
  config: null,
};

interface UseSolomonAccountOptions {
  autoRefresh?: boolean;
}

export function useSolomonAccount({ autoRefresh = true }: UseSolomonAccountOptions = {}) {
  const [state, setState] = useState<SolomonAccountState>(DEFAULT_STATE);
  const [isLoading, setIsLoading] = useState<boolean>(autoRefresh);

  const refresh = useCallback(async (): Promise<SolomonAccountSnapshot | null> => {
    try {
      setIsLoading(true);
      const result = await window.ipc.invoke("account:getSolomon", null);
      const next: SolomonAccountSnapshot = {
        signedIn: result.signedIn,
        accessToken: result.accessToken,
        config: result.config,
      };
      setState(next);
      return next;
    } catch (error) {
      console.error("Failed to load Solomon AI account state:", error);
      setState(DEFAULT_STATE);
      return null;
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!autoRefresh) return;
    refresh();
  }, [refresh, autoRefresh]);

  useEffect(() => {
    if (!autoRefresh) return;
    const cleanup = window.ipc.on("oauth:didConnect", (event) => {
      if (event.provider !== PRODUCT_PROVIDER_ID) {
        return;
      }
      refresh();
    });
    return cleanup;
  }, [refresh, autoRefresh]);

  return {
    signedIn: state.signedIn,
    accessToken: state.accessToken,
    config: state.config,
    isLoading,
    refresh,
  };
}
