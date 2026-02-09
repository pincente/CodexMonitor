import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WebDaemonClient } from "./webDaemonClient";

type MockSocket = {
  readyState: number;
  sent: string[];
  onopen: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onerror: (() => void) | null;
  onclose: (() => void) | null;
  send: (data: string) => void;
  close: () => void;
};

const OPEN = 1;
const CONNECTING = 0;

async function flush() {
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("WebDaemonClient", () => {
  let sockets: MockSocket[];

  beforeEach(() => {
    sockets = [];
    class TestWebSocket {
      static OPEN = OPEN;
      readyState = CONNECTING;
      sent: string[] = [];
      onopen: (() => void) | null = null;
      onmessage: ((event: { data: unknown }) => void) | null = null;
      onerror: (() => void) | null = null;
      onclose: (() => void) | null = null;

      constructor(_url: string) {
        sockets.push(this as unknown as MockSocket);
      }

      send(data: string) {
        this.sent.push(data);
      }

      close() {
        this.onclose?.();
      }
    }
    (TestWebSocket as { OPEN: number }).OPEN = OPEN;

    vi.stubGlobal("WebSocket", TestWebSocket);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("authenticates and resolves request responses by id", async () => {
    const client = new WebDaemonClient({ wsUrl: "ws://127.0.0.1:4733", token: "secret" });

    const pending = client.invoke<{ ok: boolean }>("ping", { value: 1 });
    expect(sockets).toHaveLength(1);

    const socket = sockets[0];
    socket.readyState = OPEN;
    socket.onopen?.();
    expect(socket.sent).toHaveLength(1);

    const authRequest = JSON.parse(socket.sent[0]) as { id: number; method: string };
    expect(authRequest.method).toBe("auth");

    socket.onmessage?.({
      data: JSON.stringify({ id: authRequest.id, result: { ok: true } }),
    });

    await flush();
    expect(socket.sent).toHaveLength(2);

    const pingRequest = JSON.parse(socket.sent[1]) as { id: number; method: string };
    expect(pingRequest.method).toBe("ping");

    socket.onmessage?.({
      data: JSON.stringify({ id: pingRequest.id, result: { ok: true } }),
    });

    await expect(pending).resolves.toEqual({ ok: true });
  });

  it("flushes pending requests on disconnect", async () => {
    const client = new WebDaemonClient({ wsUrl: "ws://127.0.0.1:4733" });

    const pending = client.invoke("ping");
    const socket = sockets[0];
    socket.readyState = OPEN;
    socket.onopen?.();
    await flush();

    expect(socket.sent).toHaveLength(1);
    client.disconnect("forced disconnect");

    await expect(pending).rejects.toThrow("remote backend disconnected");
  });

  it("forwards notifications", async () => {
    const client = new WebDaemonClient({ wsUrl: "ws://127.0.0.1:4733" });
    const notification = vi.fn();
    client.onNotification(notification);

    const pending = client.invoke("ping");
    const socket = sockets[0];
    socket.readyState = OPEN;
    socket.onopen?.();
    await flush();
    const pingRequest = JSON.parse(socket.sent[0]) as { id: number };

    socket.onmessage?.({
      data: `${JSON.stringify({ method: "thread-update", params: { id: "t-1" } })}\n${JSON.stringify({ id: pingRequest.id, result: {} })}`,
    });

    await pending;
    expect(notification).toHaveBeenCalledWith("thread-update", { id: "t-1" });
  });
});
