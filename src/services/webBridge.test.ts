import { beforeEach, describe, expect, it, vi } from "vitest";

type StorageMap = Map<string, string>;

type FakeWindow = {
  location: { href: string };
  localStorage: {
    getItem: (key: string) => string | null;
    setItem: (key: string, value: string) => void;
    removeItem: (key: string) => void;
  };
  history: {
    replaceState: (state: unknown, title: string, url?: string | URL | null) => void;
  };
  confirm: (message?: string) => boolean;
  alert: (message?: string) => void;
  prompt: (message?: string, defaultValue?: string) => string | null;
  open: (url?: string | URL, target?: string, features?: string) => Window | null;
};

const emitMock = vi.fn();
const mockWindowsMock = vi.fn();
const mockConvertFileSrcMock = vi.fn();
let bridgeHandler: ((cmd: string, args?: Record<string, unknown>) => Promise<unknown>) | null =
  null;

const mockIPCMock = vi.fn((handler: typeof bridgeHandler) => {
  bridgeHandler = handler;
});

const invokeMock = vi.fn();
const onNotificationMock = vi.fn();
const webDaemonCtorMock = vi.fn().mockImplementation(() => ({
  invoke: invokeMock,
  onNotification: onNotificationMock,
}));

vi.mock("@tauri-apps/api/event", () => ({ emit: emitMock }));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => false }));
vi.mock("@tauri-apps/api/mocks", () => ({
  mockWindows: mockWindowsMock,
  mockConvertFileSrc: mockConvertFileSrcMock,
  mockIPC: mockIPCMock,
}));
vi.mock("./webDaemonClient", () => ({ WebDaemonClient: webDaemonCtorMock }));

function createWindow(href: string) {
  const storage: StorageMap = new Map();
  const replaceState = vi.fn((_: unknown, __: string, url?: string | URL | null) => {
    if (typeof url === "string") {
      fakeWindow.location.href = url;
    } else if (url instanceof URL) {
      fakeWindow.location.href = url.toString();
    }
  });
  const fakeWindow: FakeWindow = {
    location: { href },
    localStorage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => {
        storage.set(key, value);
      },
      removeItem: (key) => {
        storage.delete(key);
      },
    },
    history: { replaceState },
    confirm: vi.fn().mockReturnValue(true),
    alert: vi.fn(),
    prompt: vi.fn().mockReturnValue("/tmp/workspace"),
    open: vi.fn().mockReturnValue(null),
  };

  return { fakeWindow, storage, replaceState };
}

describe("webBridge", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    bridgeHandler = null;
    const { fakeWindow } = createWindow(
      "http://localhost:1420/?daemonWs=ws://127.0.0.1:4733&daemonToken=test-token",
    );
    vi.stubGlobal("window", fakeWindow);
    vi.stubGlobal("navigator", { userAgent: "Macintosh" });
    vi.stubGlobal("document", {});
    vi.stubGlobal("__APP_VERSION__", "0.0.0-test");
  });

  it("bootstraps websocket bridge from URL and strips daemon token", async () => {
    const module = await import("./webBridge");
    await module.initializeWebBridge();

    expect(mockWindowsMock).toHaveBeenCalledWith("main");
    expect(mockConvertFileSrcMock).toHaveBeenCalledWith("macos");
    expect(webDaemonCtorMock).toHaveBeenCalledWith({
      wsUrl: "ws://127.0.0.1:4733",
      token: "test-token",
    });
    expect(mockIPCMock).toHaveBeenCalled();
    expect(window.location.href).not.toContain("daemonToken=");
    expect(window.localStorage.getItem("codexmonitor.daemonWs")).toBe("ws://127.0.0.1:4733");
    expect(window.localStorage.getItem("codexmonitor.daemonToken")).toBe("test-token");
  });

  it("forwards daemon notifications into tauri event emit", async () => {
    const module = await import("./webBridge");
    await module.initializeWebBridge();

    const callback = onNotificationMock.mock.calls[0]?.[0] as
      | ((method: string, params: unknown) => void)
      | undefined;
    expect(callback).toBeTypeOf("function");

    callback?.("thread-update", { workspaceId: "ws-1" });
    expect(emitMock).toHaveBeenCalledWith("thread-update", { workspaceId: "ws-1" });
  });

  it("uses plugin opener fallback and proxy invoke", async () => {
    invokeMock.mockResolvedValueOnce({ ok: true });
    const module = await import("./webBridge");
    await module.initializeWebBridge();

    expect(bridgeHandler).not.toBeNull();
    const handler = bridgeHandler as (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
    await handler("plugin:opener|open_url", { url: "https://example.com" });
    expect(window.open).toHaveBeenCalledWith(
      "https://example.com",
      "_blank",
      "noopener,noreferrer",
    );

    await expect(handler("list_workspaces", {})).resolves.toEqual({ ok: true });
    expect(invokeMock).toHaveBeenCalledWith("list_workspaces", {});
  });
});
