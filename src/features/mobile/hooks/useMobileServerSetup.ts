import { useCallback, useEffect, useMemo, useState } from "react";
import { listWorkspaces } from "../../../services/tauri";
import type { AppSettings } from "../../../types";
import { isMobilePlatform } from "../../../utils/platformPaths";
import type { MobileServerSetupWizardProps } from "../components/MobileServerSetupWizard";

type UseMobileServerSetupParams = {
  appSettings: AppSettings;
  appSettingsLoading: boolean;
  queueSaveSettings: (next: AppSettings) => Promise<AppSettings>;
  refreshWorkspaces: () => Promise<unknown>;
};

type UseMobileServerSetupResult = {
  isMobileRuntime: boolean;
  showMobileSetupWizard: boolean;
  mobileSetupWizardProps: MobileServerSetupWizardProps;
  handleMobileConnectSuccess: () => Promise<void>;
};

type NormalizedMobileRemoteDrafts = {
  host: string;
  token: string | null;
  hostWasAutoCorrected: boolean;
};

function hasValidTrailingPort(value: string): boolean {
  const match = value.match(/:(\d+)$/);
  if (!match) {
    return false;
  }
  const parsedPort = Number.parseInt(match[1], 10);
  return Number.isFinite(parsedPort) && parsedPort >= 1 && parsedPort <= 65535;
}

export function normalizeMobileRemoteDrafts(
  hostDraft: string,
  tokenDraft: string,
): NormalizedMobileRemoteDrafts {
  const token = tokenDraft.trim();
  const normalizedToken = token.length > 0 ? token : null;
  const trimmedHost = hostDraft.trim();
  if (!normalizedToken) {
    return {
      host: trimmedHost,
      token: null,
      hostWasAutoCorrected: false,
    };
  }

  const hostAlreadyHasValidPort = hasValidTrailingPort(trimmedHost);
  if (
    !hostAlreadyHasValidPort &&
    trimmedHost.endsWith(normalizedToken) &&
    trimmedHost.length > normalizedToken.length
  ) {
    const candidateHost = trimmedHost.slice(0, -normalizedToken.length).trim();
    if (hasValidTrailingPort(candidateHost)) {
      return {
        host: candidateHost,
        token: normalizedToken,
        hostWasAutoCorrected: true,
      };
    }
  }

  return {
    host: trimmedHost,
    token: normalizedToken,
    hostWasAutoCorrected: false,
  };
}

function isRemoteServerConfigured(settings: AppSettings): boolean {
  return Boolean(settings.remoteBackendToken?.trim()) && Boolean(settings.remoteBackendHost.trim());
}

function defaultMobileSetupMessage(): string {
  return "Enter host as <tailnet-host>:4732, set your token in the token field, then run Connect & test.";
}

function markActiveRemoteBackendConnected(settings: AppSettings, connectedAtMs: number): AppSettings {
  const existingBackends: AppSettings["remoteBackends"] =
    settings.remoteBackends.length > 0
      ? [...settings.remoteBackends]
      : [
          {
            id: settings.activeRemoteBackendId ?? "remote-default",
            name: "Primary remote",
            provider: "tcp" as const,
            host: settings.remoteBackendHost,
            token: settings.remoteBackendToken,
            lastConnectedAtMs: null,
          },
        ];
  const activeIndexById =
    settings.activeRemoteBackendId == null
      ? -1
      : existingBackends.findIndex((entry) => entry.id === settings.activeRemoteBackendId);
  const activeIndex = activeIndexById >= 0 ? activeIndexById : 0;
  const active = existingBackends[activeIndex];
  existingBackends[activeIndex] = {
    ...active,
    provider: "tcp",
    host: settings.remoteBackendHost,
    token: settings.remoteBackendToken,
    lastConnectedAtMs: connectedAtMs,
  };
  return {
    ...settings,
    remoteBackends: existingBackends,
    activeRemoteBackendId: existingBackends[activeIndex]?.id ?? settings.activeRemoteBackendId,
  };
}

export function useMobileServerSetup({
  appSettings,
  appSettingsLoading,
  queueSaveSettings,
  refreshWorkspaces,
}: UseMobileServerSetupParams): UseMobileServerSetupResult {
  const isMobileRuntime = useMemo(() => isMobilePlatform(), []);

  const [remoteHostDraft, setRemoteHostDraft] = useState(appSettings.remoteBackendHost);
  const [remoteTokenDraft, setRemoteTokenDraft] = useState(appSettings.remoteBackendToken ?? "");
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [statusError, setStatusError] = useState(false);
  const [mobileServerReady, setMobileServerReady] = useState(!isMobileRuntime);
  const [setupWizardDismissed, setSetupWizardDismissed] = useState(false);

  useEffect(() => {
    if (!isMobileRuntime) {
      return;
    }
    setRemoteHostDraft(appSettings.remoteBackendHost);
    setRemoteTokenDraft(appSettings.remoteBackendToken ?? "");
  }, [
    appSettings.remoteBackendHost,
    appSettings.remoteBackendToken,
    isMobileRuntime,
  ]);

  const runConnectivityCheck = useCallback(
    async (options?: { announceSuccess?: boolean }) => {
      if (!isMobileRuntime) {
        return true;
      }
      try {
        const entries = await listWorkspaces();
        try {
          await refreshWorkspaces();
        } catch {
          // Connectivity is confirmed by listWorkspaces; refresh is best-effort.
        }
        setMobileServerReady(true);
        setStatusError(false);
        if (options?.announceSuccess) {
          const count = entries.length;
          const workspaceWord = count === 1 ? "workspace" : "workspaces";
          setStatusMessage(`Connected. ${count} ${workspaceWord} available from your desktop backend.`);
        } else {
          setStatusMessage(null);
        }
        return true;
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unable to reach remote backend.";
        setMobileServerReady(false);
        setStatusError(true);
        setStatusMessage(message);
        return false;
      }
    },
    [isMobileRuntime, refreshWorkspaces],
  );

  const onConnectTest = useCallback(() => {
    void (async () => {
      if (!isMobileRuntime || busy) {
        return;
      }

      const normalizedDrafts = normalizeMobileRemoteDrafts(remoteHostDraft, remoteTokenDraft);
      const nextHost = normalizedDrafts.host;
      const nextToken = normalizedDrafts.token;

      if (normalizedDrafts.hostWasAutoCorrected && nextHost !== remoteHostDraft) {
        setRemoteHostDraft(nextHost);
      }

      if (!nextHost || !nextToken) {
        setMobileServerReady(false);
        setStatusError(true);
        setStatusMessage(defaultMobileSetupMessage());
        return;
      }

      setBusy(true);
      setSetupWizardDismissed(false);
      setStatusError(false);
      setStatusMessage(null);
      try {
        const saved = await queueSaveSettings({
          ...appSettings,
          backendMode: "remote",
          remoteBackendProvider: "tcp",
          remoteBackendHost: nextHost,
          remoteBackendToken: nextToken,
        });
        const connected = await runConnectivityCheck({ announceSuccess: true });
        if (connected) {
          await queueSaveSettings(markActiveRemoteBackendConnected(saved, Date.now()));
        }
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unable to save remote backend settings.";
        setMobileServerReady(false);
        setStatusError(true);
        setStatusMessage(message);
      } finally {
        setBusy(false);
      }
    })();
  }, [
    appSettings,
    busy,
    isMobileRuntime,
    queueSaveSettings,
    remoteHostDraft,
    remoteTokenDraft,
    runConnectivityCheck,
  ]);

  useEffect(() => {
    if (!isMobileRuntime || appSettingsLoading || busy) {
      return;
    }
    if (!isRemoteServerConfigured(appSettings)) {
      setMobileServerReady(false);
      setChecking(false);
      setStatusError(true);
      setStatusMessage(defaultMobileSetupMessage());
      return;
    }

    let active = true;
    setChecking(true);

    void (async () => {
      const ok = await runConnectivityCheck();
      if (active && !ok) {
        setStatusMessage((previous) => previous ?? "Unable to connect to remote backend.");
      }
      if (active) {
        setChecking(false);
      }
    })();

    return () => {
      active = false;
    };
  }, [
    appSettings,
    appSettingsLoading,
    busy,
    isMobileRuntime,
    runConnectivityCheck,
  ]);

  const handleMobileConnectSuccess = useCallback(async () => {
    if (!isMobileRuntime) {
      return;
    }
    setStatusError(false);
    setStatusMessage(null);
    setMobileServerReady(true);
    setSetupWizardDismissed(false);
    try {
      await refreshWorkspaces();
    } catch {
      // Keep successful connectivity result even if local refresh fails.
    }
  }, [isMobileRuntime, refreshWorkspaces]);

  return {
    isMobileRuntime,
    showMobileSetupWizard:
      isMobileRuntime && !appSettingsLoading && !mobileServerReady && !setupWizardDismissed,
    mobileSetupWizardProps: {
      remoteHostDraft,
      remoteTokenDraft,
      busy,
      checking,
      statusMessage,
      statusError,
      onClose: () => {
        setSetupWizardDismissed(true);
      },
      onRemoteHostChange: setRemoteHostDraft,
      onRemoteTokenChange: setRemoteTokenDraft,
      onConnectTest,
    },
    handleMobileConnectSuccess,
  };
}
