import { useCallback, useEffect, useRef } from "react";
import type { DebugEntry, WorkspaceInfo } from "../../../types";
import { closeTerminalSession } from "../../../services/tauri";
import { buildErrorDebugEntry } from "../../../utils/debugEntries";
import { useTerminalSession } from "./useTerminalSession";
import { useTerminalTabs } from "./useTerminalTabs";

type UseTerminalControllerOptions = {
  activeWorkspaceId: string | null;
  activeWorkspace: WorkspaceInfo | null;
  terminalOpen: boolean;
  enabled?: boolean;
  onCloseTerminalPanel?: () => void;
  onDebug: (entry: DebugEntry) => void;
};

export function useTerminalController({
  activeWorkspaceId,
  activeWorkspace,
  terminalOpen,
  enabled = true,
  onCloseTerminalPanel,
  onDebug,
}: UseTerminalControllerOptions) {
  const cleanupTerminalRef = useRef<((workspaceId: string, terminalId: string) => void) | null>(
    null,
  );
  const shouldIgnoreTerminalCloseError = useCallback((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    return message.includes("Terminal session not found");
  }, []);

  const handleTerminalClose = useCallback(
    async (workspaceId: string, terminalId: string) => {
      if (!enabled) {
        return;
      }
      cleanupTerminalRef.current?.(workspaceId, terminalId);
      try {
        await closeTerminalSession(workspaceId, terminalId);
      } catch (error) {
        if (shouldIgnoreTerminalCloseError(error)) {
          return;
        }
        onDebug(buildErrorDebugEntry("terminal close error", error));
      }
    },
    [enabled, onDebug, shouldIgnoreTerminalCloseError],
  );

  const {
    terminals: terminalTabs,
    activeTerminalId,
    createTerminal,
    ensureTerminalWithTitle,
    closeTerminal,
    setActiveTerminal,
    ensureTerminal,
  } = useTerminalTabs({
    activeWorkspaceId,
    onCloseTerminal: handleTerminalClose,
  });

  useEffect(() => {
    if (enabled && terminalOpen && activeWorkspaceId) {
      ensureTerminal(activeWorkspaceId);
    }
  }, [activeWorkspaceId, enabled, ensureTerminal, terminalOpen]);

  const terminalState = useTerminalSession({
    activeWorkspace,
    activeTerminalId,
    isVisible: enabled && terminalOpen,
    onDebug,
    onSessionExit: (workspaceId, terminalId) => {
      const shouldClosePanel =
        workspaceId === activeWorkspaceId &&
        terminalTabs.length === 1 &&
        terminalTabs[0]?.id === terminalId;
      closeTerminal(workspaceId, terminalId);
      if (shouldClosePanel) {
        onCloseTerminalPanel?.();
      }
    },
  });

  useEffect(() => {
    cleanupTerminalRef.current = terminalState.cleanupTerminalSession;
  }, [terminalState.cleanupTerminalSession]);

  const onSelectTerminal = useCallback(
    (terminalId: string) => {
      if (!enabled || !activeWorkspaceId) {
        return;
      }
      setActiveTerminal(activeWorkspaceId, terminalId);
    },
    [activeWorkspaceId, enabled, setActiveTerminal],
  );

  const onNewTerminal = useCallback(() => {
    if (!enabled || !activeWorkspaceId) {
      return;
    }
    createTerminal(activeWorkspaceId);
  }, [activeWorkspaceId, createTerminal, enabled]);

  const onCloseTerminal = useCallback(
    (terminalId: string) => {
      if (!enabled || !activeWorkspaceId) {
        return;
      }
      const shouldClosePanel =
        terminalTabs.length === 1 && terminalTabs[0]?.id === terminalId;
      closeTerminal(activeWorkspaceId, terminalId);
      if (shouldClosePanel) {
        onCloseTerminalPanel?.();
      }
    },
    [activeWorkspaceId, closeTerminal, enabled, onCloseTerminalPanel, terminalTabs],
  );

  const restartTerminalSession = useCallback(
    async (workspaceId: string, terminalId: string) => {
      if (!enabled) {
        throw new Error("Terminal is unavailable in browser mode.");
      }
      cleanupTerminalRef.current?.(workspaceId, terminalId);
      try {
        await closeTerminalSession(workspaceId, terminalId);
      } catch (error) {
        if (!shouldIgnoreTerminalCloseError(error)) {
          onDebug(buildErrorDebugEntry("terminal close error", error));
          throw error;
        }
      }
    },
    [enabled, onDebug, shouldIgnoreTerminalCloseError],
  );

  return {
    terminalTabs: enabled ? terminalTabs : [],
    activeTerminalId: enabled ? activeTerminalId : null,
    onSelectTerminal,
    onNewTerminal,
    onCloseTerminal,
    terminalState: enabled ? terminalState : null,
    ensureTerminalWithTitle,
    restartTerminalSession,
  };
}
