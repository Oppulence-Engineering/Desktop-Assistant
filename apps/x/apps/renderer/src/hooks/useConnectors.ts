import { useState, useEffect, useCallback, useRef } from "react";
import { setGoogleCredentials, clearGoogleCredentials } from "@/lib/google-credentials-store";
import { toast } from "sonner";
import { PRODUCT_NAME, getProductProviderState, isProductProvider } from "@x/shared/branding";
import type {
  ConnectorEntitlement,
  ConnectorLifecycleState,
  ConnectorScope,
} from "@x/shared/connectors";
import { connectorLifecycleAction } from "@x/shared/connectors";

export interface ProviderState {
  isConnected: boolean;
  isLoading: boolean;
  isConnecting: boolean;
}

export interface ProviderStatus {
  error?: string;
}

export interface IntegrationTemplateBlock {
  id: string;
  title: string;
  description: string;
  category: string;
  requiredScopes?: string[];
  mcpTools?: string[];
  nativeTools?: string[];
  trustTier: "read" | "write" | "act" | "money-moving";
  samplePrompt?: string;
}

export interface IntegrationConnector {
  name: string;
  displayName: string;
  description: string;
  mcpUrl: string;
  transport?: "mcp" | "native";
  authType: "oauth" | "api_key";
  scopes?: string[];
  grantedScopes?: ConnectorScope[];
  availableScopes?: ConnectorScope[];
  connectionHealth?: ConnectorLifecycleState;
  connectionHealthMessage?: string;
  entitlement?: ConnectorEntitlement;
  status?: string;
  lastUsedAt?: string;
  iconUrl?: string;
  templateBlocks?: IntegrationTemplateBlock[];
  nativeTools?: Array<{ name: string; trustTier?: "read" | "write" | "act" | "money-moving" }>;
  mcpTools?: Array<{
    name: string;
    trustTier?: "read" | "write" | "act" | "money-moving";
    requiredScopes?: string[];
  }>;
  connected: boolean;
  connectedAt?: string;
}

export interface SlackWorkspace {
  url?: string;
  name: string;
  teamId?: string;
  scopes?: string[];
  connectedAt?: string;
  source?: "managed" | "local";
}

function settleWithin<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = window.setTimeout(
      () => reject(new Error(`${label} timed out after ${timeoutMs}ms`)),
      timeoutMs,
    );
    promise.then(
      (value) => {
        window.clearTimeout(timeout);
        resolve(value);
      },
      (error) => {
        window.clearTimeout(timeout);
        reject(error);
      },
    );
  });
}

export function useConnectors(active: boolean) {
  const [providers, setProviders] = useState<string[]>([]);
  const [providersLoading, setProvidersLoading] = useState(true);
  const [providerStates, setProviderStates] = useState<Record<string, ProviderState>>({});
  const [providerStatus, setProviderStatus] = useState<Record<string, ProviderStatus>>({});
  const [googleClientIdOpen, setGoogleClientIdOpen] = useState(false);
  const [googleClientIdDescription, setGoogleClientIdDescription] = useState<string | undefined>(
    undefined,
  );
  const [integrations, setIntegrations] = useState<IntegrationConnector[]>([]);
  const [integrationsLoading, setIntegrationsLoading] = useState(true);
  const [integrationConnecting, setIntegrationConnecting] = useState<Record<string, boolean>>({});
  const [integrationApiKeyOpen, setIntegrationApiKeyOpen] = useState(false);
  const [integrationApiKeyTarget, setIntegrationApiKeyTarget] =
    useState<IntegrationConnector | null>(null);
  const [integrationApiKeySubmitting, setIntegrationApiKeySubmitting] = useState(false);

  // Granola state
  const [granolaEnabled, setGranolaEnabled] = useState(false);
  const [granolaLoading, setGranolaLoading] = useState(true);

  // Slack state
  const [slackEnabled, setSlackEnabled] = useState(false);
  const [slackLoading, setSlackLoading] = useState(true);
  const [slackWorkspaces, setSlackWorkspaces] = useState<SlackWorkspace[]>([]);
  const [slackDiscovering, setSlackDiscovering] = useState(false);
  const [slackDiscoverError, setSlackDiscoverError] = useState<string | null>(null);

  // Load available providers on mount
  useEffect(() => {
    async function loadProviders() {
      try {
        setProvidersLoading(true);
        const result = await window.ipc.invoke("oauth:list-providers", null);
        setProviders(result.providers || []);
      } catch (error) {
        console.error("Failed to get available providers:", error);
        setProviders([]);
      } finally {
        setProvidersLoading(false);
      }
    }
    loadProviders();
  }, []);

  // Load Granola config
  const refreshGranolaConfig = useCallback(async () => {
    try {
      setGranolaLoading(true);
      const result = await window.ipc.invoke("granola:getConfig", null);
      setGranolaEnabled(result.enabled);
    } catch (error) {
      console.error("Failed to load Granola config:", error);
      setGranolaEnabled(false);
    } finally {
      setGranolaLoading(false);
    }
  }, []);

  const handleGranolaToggle = useCallback(async (enabled: boolean) => {
    try {
      setGranolaLoading(true);
      await window.ipc.invoke("granola:setConfig", { enabled });
      setGranolaEnabled(enabled);
      toast.success(enabled ? "Granola sync enabled" : "Granola sync disabled");
    } catch (error) {
      console.error("Failed to update Granola config:", error);
      toast.error("Failed to update Granola sync settings");
    } finally {
      setGranolaLoading(false);
    }
  }, []);

  // Slack
  const refreshSlackConfig = useCallback(async () => {
    try {
      setSlackLoading(true);
      const result = await window.ipc.invoke("slack:getConfig", null);
      setSlackEnabled(result.enabled);
      setSlackWorkspaces(result.workspaces || []);
      setSlackDiscoverError(result.error ?? null);
    } catch (error) {
      console.error("Failed to load Slack config:", error);
      setSlackEnabled(false);
      setSlackWorkspaces([]);
    } finally {
      setSlackLoading(false);
    }
  }, []);

  const handleSlackEnable = useCallback(async () => {
    setSlackDiscovering(true);
    setSlackDiscoverError(null);
    try {
      const result = await window.ipc.invoke("slack:connectWorkspace", null);
      if (!result.success) {
        const message = result.error || "Failed to start Slack connection";
        setSlackDiscoverError(message);
        toast.error(message);
      }
    } catch (error) {
      console.error("Failed to connect Slack:", error);
      setSlackDiscoverError("Failed to connect Slack");
      toast.error("Failed to connect Slack");
    } finally {
      setSlackDiscovering(false);
    }
  }, []);

  const handleSlackDisable = useCallback(async () => {
    try {
      setSlackLoading(true);
      const managedWorkspaces = slackWorkspaces.filter((workspace) => workspace.teamId);
      if (managedWorkspaces.length > 0) {
        const results = await Promise.all(
          managedWorkspaces.map((workspace) =>
            window.ipc.invoke("slack:disconnectWorkspace", { teamId: workspace.teamId }),
          ),
        );
        const failed = results.find((result) => !result.success);
        if (failed) {
          throw new Error(failed.error || "Failed to disconnect Slack");
        }
      } else {
        await window.ipc.invoke("slack:setConfig", { enabled: false, workspaces: [] });
      }
      setSlackEnabled(false);
      setSlackWorkspaces([]);
      toast.success("Slack disabled");
    } catch (error) {
      console.error("Failed to update Slack config:", error);
      toast.error("Failed to update Slack settings");
    } finally {
      setSlackLoading(false);
    }
  }, [slackWorkspaces]);

  // ... (ERRORS.md E49) Per-provider safety timeouts. The managed connect flow
  // opens the browser and returns success immediately; if the user abandons it,
  // the renderer never hears oauth:didConnect, so the Connect spinner would
  // hang forever. These reset the connecting state after a grace period.
  const connectTimeoutsRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const CONNECT_TIMEOUT_MS = 120_000;

  const clearConnectTimeout = useCallback((provider: string) => {
    const handle = connectTimeoutsRef.current[provider];
    if (handle) {
      clearTimeout(handle);
      delete connectTimeoutsRef.current[provider];
    }
  }, []);

  const integrationConnectTimeoutsRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const clearIntegrationConnectTimeout = useCallback((connector: string) => {
    const handle = integrationConnectTimeoutsRef.current[connector];
    if (handle) {
      clearTimeout(handle);
      delete integrationConnectTimeoutsRef.current[connector];
    }
  }, []);

  const refreshIntegrations = useCallback(async () => {
    try {
      setIntegrationsLoading(true);
      const result = await window.ipc.invoke("connectors:list", null);
      setIntegrations(result.connectors || []);
      if (result.error) {
        console.warn("Failed to list integrations:", result.error);
      }
    } catch (error) {
      console.error("Failed to list integrations:", error);
      setIntegrations([]);
    } finally {
      setIntegrationsLoading(false);
    }
  }, []);

  const handleConnectIntegration = useCallback(
    async (connector: IntegrationConnector) => {
      const lifecycleAction = connectorLifecycleAction(connector);
      if (
        lifecycleAction === "disconnect" ||
        lifecycleAction === "wait" ||
        lifecycleAction === "unavailable"
      )
        return;
      if (connector.authType === "api_key") {
        setIntegrationApiKeyTarget(connector);
        setIntegrationApiKeyOpen(true);
        return;
      }

      setIntegrationConnecting((prev) => ({ ...prev, [connector.name]: true }));
      clearIntegrationConnectTimeout(connector.name);
      integrationConnectTimeoutsRef.current[connector.name] = setTimeout(() => {
        delete integrationConnectTimeoutsRef.current[connector.name];
        setIntegrationConnecting((prev) => ({ ...prev, [connector.name]: false }));
        toast.message("Connect didn't finish — try again");
      }, CONNECT_TIMEOUT_MS);

      try {
        const result = await window.ipc.invoke("connectors:connect", {
          connector: connector.name,
          requestedScopes: connector.availableScopes?.map((scope) => scope.name),
          // The broker parks the provider grant until Electron redeems the
          // one-time session through the authenticated claim endpoint. This
          // exact URI is handled by main, not by renderer navigation.
          redirectAfter: "solomon-ai://connection-complete",
        });
        if (!result.success) {
          clearIntegrationConnectTimeout(connector.name);
          setIntegrationConnecting((prev) => ({ ...prev, [connector.name]: false }));
          toast.error(result.error || `Failed to connect ${connector.displayName}`);
        }
      } catch (error) {
        clearIntegrationConnectTimeout(connector.name);
        setIntegrationConnecting((prev) => ({ ...prev, [connector.name]: false }));
        console.error("Failed to connect integration:", error);
        toast.error(`Failed to connect ${connector.displayName}`);
      }
    },
    [clearIntegrationConnectTimeout],
  );

  const handleIntegrationApiKeySubmit = useCallback(
    async (apiKey: string) => {
      if (!integrationApiKeyTarget) return;
      try {
        setIntegrationApiKeySubmitting(true);
        const result = await window.ipc.invoke("connectors:saveApiKey", {
          connector: integrationApiKeyTarget.name,
          apiKey,
        });
        if (!result.success) {
          toast.error(result.error || `Failed to connect ${integrationApiKeyTarget.displayName}`);
          return;
        }
        toast.success(`Connected to ${integrationApiKeyTarget.displayName}`);
        setIntegrationApiKeyOpen(false);
        setIntegrationApiKeyTarget(null);
        await refreshIntegrations();
      } catch (error) {
        console.error("Failed to save integration API key:", error);
        toast.error(`Failed to connect ${integrationApiKeyTarget.displayName}`);
      } finally {
        setIntegrationApiKeySubmitting(false);
      }
    },
    [integrationApiKeyTarget, refreshIntegrations],
  );

  const handleDisconnectIntegration = useCallback(
    async (connector: IntegrationConnector) => {
      try {
        setIntegrationConnecting((prev) => ({ ...prev, [connector.name]: true }));
        const result = await window.ipc.invoke("connectors:disconnect", {
          connector: connector.name,
        });
        if (!result.success) {
          toast.error(result.error || `Failed to disconnect ${connector.displayName}`);
          return;
        }
        toast.success(`Disconnected from ${connector.displayName}`);
        await refreshIntegrations();
      } catch (error) {
        console.error("Failed to disconnect integration:", error);
        toast.error(`Failed to disconnect ${connector.displayName}`);
      } finally {
        setIntegrationConnecting((prev) => ({ ...prev, [connector.name]: false }));
      }
    },
    [refreshIntegrations],
  );

  const handleAuthorizeIntegrationScopes = useCallback(
    async (connector: IntegrationConnector, scopes: string[]) => {
      try {
        setIntegrationConnecting((prev) => ({ ...prev, [connector.name]: true }));
        const result = await window.ipc.invoke("connectors:authorizeScopes", {
          connector: connector.name,
          scopes,
        });
        if (!result.success) {
          toast.error(result.error || `Authorization failed for ${connector.displayName}`);
          return;
        }
        toast.success(`Authorized protected access for ${connector.displayName}`);
        await refreshIntegrations();
      } finally {
        setIntegrationConnecting((prev) => ({ ...prev, [connector.name]: false }));
      }
    },
    [refreshIntegrations],
  );

  // OAuth connect/disconnect
  const startConnect = useCallback(
    async (provider: string, credentials?: { clientId: string; clientSecret: string }) => {
      setProviderStates((prev) => ({
        ...prev,
        [provider]: { ...prev[provider], isConnecting: true },
      }));

      // ... (ERRORS.md E49) Safety timeout for an abandoned browser flow.
      clearConnectTimeout(provider);
      connectTimeoutsRef.current[provider] = setTimeout(() => {
        delete connectTimeoutsRef.current[provider];
        let wasConnecting = false;
        setProviderStates((prev) => {
          if (!prev[provider]?.isConnecting) return prev;
          wasConnecting = true;
          return { ...prev, [provider]: { ...prev[provider], isConnecting: false } };
        });
        if (wasConnecting) toast.message("Connect didn't finish — try again");
      }, CONNECT_TIMEOUT_MS);

      try {
        const result = await window.ipc.invoke("oauth:connect", {
          provider,
          clientId: credentials?.clientId,
          clientSecret: credentials?.clientSecret,
        });

        if (!result.success) {
          clearConnectTimeout(provider);
          toast.error(
            result.error ||
              (isProductProvider(provider)
                ? `Failed to log in to ${PRODUCT_NAME}`
                : `Failed to connect to ${provider}`),
          );
          setProviderStates((prev) => ({
            ...prev,
            [provider]: { ...prev[provider], isConnecting: false },
          }));
        }
      } catch (error) {
        clearConnectTimeout(provider);
        console.error("Failed to connect:", error);
        toast.error(
          isProductProvider(provider)
            ? `Failed to log in to ${PRODUCT_NAME}`
            : `Failed to connect to ${provider}`,
        );
        setProviderStates((prev) => ({
          ...prev,
          [provider]: { ...prev[provider], isConnecting: false },
        }));
      }
    },
    [clearConnectTimeout],
  );

  const handleConnect = useCallback(
    async (provider: string) => {
      if (provider === "google") {
        // Signed-in users use the Solomon AI managed-credentials flow: opens
        // the webapp in the browser, no BYOK modal. Main process detects
        // signed-in via isSignedIn() when oauth:connect arrives without creds.
        // Falls back to the BYOK modal for not-signed-in users.
        const isSignedIntoSolomon = getProductProviderState(providerStates)?.isConnected ?? false;
        if (isSignedIntoSolomon) {
          await startConnect("google");
          return;
        }
        setGoogleClientIdDescription(undefined);
        setGoogleClientIdOpen(true);
        return;
      }

      await startConnect(provider);
    },
    [startConnect, providerStates],
  );

  const handleGoogleClientIdSubmit = useCallback(
    (clientId: string, clientSecret: string) => {
      setGoogleCredentials(clientId, clientSecret);
      setGoogleClientIdOpen(false);
      setGoogleClientIdDescription(undefined);
      startConnect("google", { clientId, clientSecret });
    },
    [startConnect],
  );

  // Reconnect flow used by the "Reconnect" button. Mirrors handleConnect's
  // Solomon AI-vs-BYOK branching for Google so signed-in users don't get the
  // client-ID modal — they just re-run the managed-credentials browser flow.
  const handleReconnect = useCallback(
    async (provider: string) => {
      if (provider === "google") {
        const isSignedIntoSolomon = getProductProviderState(providerStates)?.isConnected ?? false;
        if (isSignedIntoSolomon) {
          await startConnect("google");
          return;
        }
        setGoogleClientIdDescription(
          "To keep your Google account connected, please re-enter your client ID. You only need to do this once.",
        );
        setGoogleClientIdOpen(true);
        return;
      }
      await startConnect(provider);
    },
    [startConnect, providerStates],
  );

  const handleDisconnect = useCallback(async (provider: string) => {
    setProviderStates((prev) => ({
      ...prev,
      [provider]: { ...prev[provider], isLoading: true },
    }));

    try {
      const result = await window.ipc.invoke("oauth:disconnect", { provider });

      if (result.success) {
        if (provider === "google") {
          clearGoogleCredentials();
        }
        const displayName =
          provider === "fireflies-ai"
            ? "Fireflies"
            : provider.charAt(0).toUpperCase() + provider.slice(1);
        toast.success(
          isProductProvider(provider)
            ? `Logged out of ${PRODUCT_NAME}`
            : `Disconnected from ${displayName}`,
        );
        setProviderStates((prev) => ({
          ...prev,
          [provider]: {
            isConnected: false,
            isLoading: false,
            isConnecting: false,
          },
        }));
      } else {
        toast.error(
          isProductProvider(provider)
            ? `Failed to log out of ${PRODUCT_NAME}`
            : `Failed to disconnect from ${provider}`,
        );
        setProviderStates((prev) => ({
          ...prev,
          [provider]: { ...prev[provider], isLoading: false },
        }));
      }
    } catch (error) {
      console.error("Failed to disconnect:", error);
      toast.error(
        isProductProvider(provider)
          ? `Failed to log out of ${PRODUCT_NAME}`
          : `Failed to disconnect from ${provider}`,
      );
      setProviderStates((prev) => ({
        ...prev,
        [provider]: { ...prev[provider], isLoading: false },
      }));
    }
  }, []);

  // Refresh all statuses
  const refreshAllStatuses = useCallback(async () => {
    refreshIntegrations();
    refreshGranolaConfig();
    refreshSlackConfig();

    if (providers.length === 0) return;

    const newStates: Record<string, ProviderState> = {};

    try {
      const result = await settleWithin(
        window.ipc.invoke("oauth:getState", null),
        5_000,
        "Connection status check",
      );
      const config = result.config || {};
      const statusMap: Record<string, ProviderStatus> = {};

      for (const provider of providers) {
        const providerConfig = config[provider];
        newStates[provider] = {
          isConnected: providerConfig?.connected ?? false,
          isLoading: false,
          isConnecting: false,
        };
        if (providerConfig?.error) {
          statusMap[provider] = { error: providerConfig.error };
        }
      }

      setProviderStatus(statusMap);
    } catch (error) {
      console.error("Failed to check connection statuses:", error);
      for (const provider of providers) {
        newStates[provider] = {
          isConnected: false,
          isLoading: false,
          isConnecting: false,
        };
      }
      setProviderStatus({});
    }

    setProviderStates(newStates);
  }, [providers, refreshGranolaConfig, refreshIntegrations, refreshSlackConfig]);

  // Refresh when active or providers change
  useEffect(() => {
    if (active) {
      refreshAllStatuses();
    }
  }, [active, providers, refreshAllStatuses]);

  // Listen for OAuth events
  useEffect(() => {
    const cleanup = window.ipc.on("oauth:didConnect", async (event) => {
      const { provider, success } = event;

      // ... (ERRORS.md E49) Outcome arrived — cancel the safety timeout.
      clearConnectTimeout(provider);
      clearIntegrationConnectTimeout(provider);
      setIntegrationConnecting((prev) => ({ ...prev, [provider]: false }));

      if (provider === "slack") {
        setSlackDiscovering(false);
        if (success) {
          toast.success("Connected to Slack");
          refreshSlackConfig();
        } else {
          toast.error(event.error || "Failed to connect Slack");
        }
        return;
      }

      setProviderStates((prev) => ({
        ...prev,
        [provider]: {
          isConnected: success,
          isLoading: false,
          isConnecting: false,
        },
      }));

      if (success) {
        const displayName =
          provider === "fireflies-ai"
            ? "Fireflies"
            : provider.charAt(0).toUpperCase() + provider.slice(1);
        if (isProductProvider(provider)) {
          toast.success(`Logged in to ${PRODUCT_NAME}`);
        } else if (provider === "google" || provider === "fireflies-ai") {
          toast.success(`Connected to ${displayName}`, {
            description:
              "Syncing your data in the background. This may take a few minutes before changes appear.",
            duration: 8000,
          });
        } else {
          toast.success(`Connected to ${displayName}`);
        }

        refreshAllStatuses();
      }
    });

    return cleanup;
  }, [refreshAllStatuses, refreshSlackConfig, clearConnectTimeout, clearIntegrationConnectTimeout]);

  const hasProviderError = Object.values(providerStatus).some((status) => Boolean(status?.error));

  return {
    // OAuth providers
    providers,
    providersLoading,
    providerStates,
    providerStatus,
    hasProviderError,
    handleConnect,
    handleReconnect,
    handleDisconnect,
    startConnect,

    // Google credentials modal
    googleClientIdOpen,
    setGoogleClientIdOpen,
    googleClientIdDescription,
    setGoogleClientIdDescription,
    handleGoogleClientIdSubmit,

    // Rowboat integrations
    integrations,
    integrationsLoading,
    integrationConnecting,
    integrationApiKeyOpen,
    setIntegrationApiKeyOpen,
    integrationApiKeyTarget,
    integrationApiKeySubmitting,
    handleConnectIntegration,
    handleIntegrationApiKeySubmit,
    handleDisconnectIntegration,
    handleAuthorizeIntegrationScopes,
    refreshIntegrations,

    // Granola
    granolaEnabled,
    granolaLoading,
    handleGranolaToggle,

    // Slack
    slackEnabled,
    slackLoading,
    slackWorkspaces,
    slackDiscovering,
    slackDiscoverError,
    handleSlackEnable,
    handleSlackDisable,

    // Refresh
    refreshAllStatuses,
  };
}
