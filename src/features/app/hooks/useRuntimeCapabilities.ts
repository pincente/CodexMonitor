import { useMemo } from "react";
import { isTauri } from "@tauri-apps/api/core";

export type RuntimeCapabilities = {
  isTauriRuntime: boolean;
  supportsTerminal: boolean;
  supportsDictation: boolean;
  supportsDaemonControls: boolean;
};

export function useRuntimeCapabilities(): RuntimeCapabilities {
  return useMemo(() => {
    const tauriRuntime = isTauri();
    return {
      isTauriRuntime: tauriRuntime,
      supportsTerminal: tauriRuntime,
      supportsDictation: tauriRuntime,
      supportsDaemonControls: tauriRuntime,
    };
  }, []);
}
