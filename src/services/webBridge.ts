import { emit } from "@tauri-apps/api/event";
import { isTauri } from "@tauri-apps/api/core";
import { mockConvertFileSrc, mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { WebDaemonClient } from "./webDaemonClient";

const WS_URL_STORAGE_KEY = "codexmonitor.daemonWs";
const TOKEN_STORAGE_KEY = "codexmonitor.daemonToken";
const TAURI_BACKEND_UNAVAILABLE_MESSAGE =
  "CodexMonitor backend is unavailable in browser mode. Configure daemonWs and run codex_monitor_daemon with --ws-listen.";

let initialized = false;

function detectMockOsName() {
  const userAgent = typeof navigator === "undefined" ? "" : navigator.userAgent;
  if (/Windows/i.test(userAgent)) {
    return "windows";
  }
  if (/Macintosh|Mac OS X/i.test(userAgent)) {
    return "macos";
  }
  return "linux";
}

function readBootstrapConfig() {
  if (typeof window === "undefined") {
    return { wsUrl: null as string | null, token: null as string | null };
  }

  const url = new URL(window.location.href);
  const wsParam = url.searchParams.get("daemonWs");
  const tokenParam = url.searchParams.get("daemonToken");

  if (wsParam && wsParam.trim().length > 0) {
    window.localStorage.setItem(WS_URL_STORAGE_KEY, wsParam.trim());
  }
  if (tokenParam && tokenParam.trim().length > 0) {
    window.localStorage.setItem(TOKEN_STORAGE_KEY, tokenParam.trim());
    url.searchParams.delete("daemonToken");
    window.history.replaceState({}, "", url.toString());
  }

  const wsUrl = window.localStorage.getItem(WS_URL_STORAGE_KEY);
  const token = window.localStorage.getItem(TOKEN_STORAGE_KEY);
  return {
    wsUrl: wsUrl && wsUrl.trim().length > 0 ? wsUrl.trim() : null,
    token: token && token.trim().length > 0 ? token.trim() : null,
  };
}

function isImageDialogRequest(options: Record<string, unknown>) {
  const filters = Array.isArray(options.filters) ? options.filters : [];
  return filters.some((entry) => {
    if (!entry || typeof entry !== "object") {
      return false;
    }
    const extensions = Array.isArray((entry as { extensions?: unknown }).extensions)
      ? ((entry as { extensions: unknown[] }).extensions as unknown[])
      : [];
    return extensions.some((ext) =>
      typeof ext === "string"
        ? ["png", "jpg", "jpeg", "gif", "webp", "bmp", "tiff", "tif"].includes(
            ext.toLowerCase(),
          )
        : false,
    );
  });
}

async function pickImagesAsDataUrls(multiple: boolean): Promise<string[] | string | null> {
  if (typeof document === "undefined") {
    return null;
  }

  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/*";
  input.multiple = multiple;

  return new Promise((resolve) => {
    input.onchange = async () => {
      const files = Array.from(input.files ?? []);
      if (files.length === 0) {
        resolve(multiple ? [] : null);
        return;
      }

      const values = await Promise.all(
        files.map(
          (file) =>
            new Promise<string>((fileResolve, fileReject) => {
              const reader = new FileReader();
              reader.onload = () => {
                if (typeof reader.result === "string") {
                  fileResolve(reader.result);
                  return;
                }
                fileResolve("");
              };
              reader.onerror = () => {
                fileReject(new Error(`Failed to read ${file.name}`));
              };
              reader.readAsDataURL(file);
            }),
        ),
      );
      const filtered = values.filter((value) => value.length > 0);
      if (multiple) {
        resolve(filtered);
        return;
      }
      resolve(filtered[0] ?? null);
    };

    input.click();
  });
}

function promptForPaths(multiple: boolean, directory: boolean): string[] | string | null {
  if (typeof window === "undefined") {
    return multiple ? [] : null;
  }

  const guidance = directory
    ? "Enter an absolute directory path"
    : "Enter an absolute file path";
  const raw = window.prompt(
    multiple
      ? `${guidance}. For multiple paths, separate with commas.`
      : guidance,
    "",
  );

  if (!raw || raw.trim().length === 0) {
    return multiple ? [] : null;
  }

  if (!multiple) {
    return raw.trim();
  }

  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

async function handleDialogOpen(args: unknown) {
  const options =
    args && typeof args === "object" && (args as { options?: unknown }).options
      ? ((args as { options?: unknown }).options as Record<string, unknown>)
      : {};
  const multiple = options.multiple === true;
  const directory = options.directory === true;

  if (isImageDialogRequest(options) && !directory) {
    return pickImagesAsDataUrls(multiple);
  }

  return promptForPaths(multiple, directory);
}

function handleMenuCommand(cmd: string) {
  if (cmd === "plugin:menu|new") {
    return [Math.floor(Math.random() * 1_000_000), `menu-${Date.now()}`];
  }
  if (cmd === "plugin:menu|items") {
    return [];
  }
  if (cmd === "plugin:menu|get") {
    return null;
  }
  if (cmd === "plugin:menu|remove_at") {
    return null;
  }
  if (cmd === "plugin:menu|create_default") {
    return [Math.floor(Math.random() * 1_000_000), "menu-default"];
  }
  return null;
}

function createBridgeHandler(client: WebDaemonClient | null) {
  return async (cmd: string, args?: unknown) => {
    const argRecord =
      args && typeof args === "object" && !Array.isArray(args)
        ? (args as Record<string, unknown>)
        : null;

    if (cmd.startsWith("plugin:dialog|")) {
      if (cmd === "plugin:dialog|open") {
        return handleDialogOpen(args);
      }
      if (cmd === "plugin:dialog|ask" || cmd === "plugin:dialog|confirm") {
        const message = typeof argRecord?.message === "string" ? argRecord.message : "Continue?";
        return window.confirm(message);
      }
      if (cmd === "plugin:dialog|message") {
        const message = typeof argRecord?.message === "string" ? argRecord.message : "";
        window.alert(message);
        return null;
      }
      return null;
    }

    if (cmd.startsWith("plugin:opener|")) {
      if (cmd === "plugin:opener|open_url") {
        const url = typeof argRecord?.url === "string" ? argRecord.url : "";
        if (url) {
          window.open(url, "_blank", "noopener,noreferrer");
        }
        return null;
      }
      if (cmd === "plugin:opener|reveal_item_in_dir" || cmd === "plugin:opener|open_path") {
        throw new Error("This action is not available in browser mode.");
      }
      return null;
    }

    if (cmd.startsWith("plugin:app|")) {
      if (cmd === "plugin:app|version") {
        return __APP_VERSION__;
      }
      return null;
    }

    if (cmd.startsWith("plugin:menu|")) {
      return handleMenuCommand(cmd);
    }

    if (cmd.startsWith("plugin:window|") || cmd.startsWith("plugin:webview|")) {
      if (cmd.endsWith("get_all_windows") || cmd.endsWith("get_all_webviews")) {
        return [];
      }
      return null;
    }

    if (!client) {
      throw new Error(TAURI_BACKEND_UNAVAILABLE_MESSAGE);
    }

    const params =
      argRecord ?? {};
    return client.invoke(cmd, params);
  };
}

export function isBrowserRuntimeWithoutTauri() {
  if (typeof window === "undefined") {
    return false;
  }
  return !isTauri();
}

export async function initializeWebBridge() {
  if (initialized) {
    return;
  }
  initialized = true;

  if (!isBrowserRuntimeWithoutTauri()) {
    return;
  }

  mockWindows("main");
  mockConvertFileSrc(detectMockOsName());

  const config = readBootstrapConfig();
  const client = config.wsUrl
    ? new WebDaemonClient({ wsUrl: config.wsUrl, token: config.token })
    : null;

  if (client) {
    client.onNotification((method, params) => {
      void emit(method, params);
    });
  }

  mockIPC(createBridgeHandler(client), { shouldMockEvents: true });
}
