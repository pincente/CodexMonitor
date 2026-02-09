export type JsonRpcParams = Record<string, unknown>;

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
};

type NotificationHandler = (method: string, params: unknown) => void;

export type WebDaemonClientConfig = {
  wsUrl: string;
  token?: string | null;
};

function toError(message: string) {
  return new Error(message);
}

function parseErrorMessage(payload: unknown) {
  if (!payload || typeof payload !== "object") {
    return "remote backend error";
  }
  const message = (payload as { message?: unknown }).message;
  return typeof message === "string" && message.trim().length > 0
    ? message
    : "remote backend error";
}

export class WebDaemonClient {
  private wsUrl: string;
  private token: string | null;
  private ws: WebSocket | null = null;
  private connectPromise: Promise<void> | null = null;
  private nextId = 1;
  private pending = new Map<number, PendingRequest>();
  private notificationHandler: NotificationHandler | null = null;

  constructor(config: WebDaemonClientConfig) {
    this.wsUrl = config.wsUrl;
    this.token = config.token ?? null;
  }

  setConfig(config: WebDaemonClientConfig) {
    const nextToken = config.token ?? null;
    if (this.wsUrl === config.wsUrl && this.token === nextToken) {
      return;
    }
    this.wsUrl = config.wsUrl;
    this.token = nextToken;
    this.disconnect("remote backend disconnected");
  }

  onNotification(handler: NotificationHandler | null) {
    this.notificationHandler = handler;
  }

  async invoke<T>(method: string, params?: JsonRpcParams): Promise<T> {
    await this.ensureConnected();
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        reject(toError("remote backend disconnected"));
        return;
      }

      this.pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
      });

      try {
        this.ws.send(
          JSON.stringify({
            id,
            method,
            params: params ?? {},
          }),
        );
      } catch (error) {
        this.pending.delete(id);
        reject(error instanceof Error ? error : toError(String(error)));
      }
    });
  }

  disconnect(reason = "remote backend disconnected") {
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        // no-op
      }
    }
    this.ws = null;
    this.connectPromise = null;
    this.flushPending(reason);
  }

  private async ensureConnected() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      return;
    }

    if (this.connectPromise) {
      return this.connectPromise;
    }

    this.connectPromise = new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(this.wsUrl);
      this.ws = ws;
      let settled = false;

      const fail = (message: string) => {
        if (settled) {
          return;
        }
        settled = true;
        this.connectPromise = null;
        this.ws = null;
        reject(toError(message));
      };

      ws.onopen = () => {
        if (!this.token) {
          settled = true;
          this.connectPromise = null;
          resolve();
          return;
        }

        const authId = this.nextId++;
        this.pending.set(authId, {
          resolve: () => {
            settled = true;
            this.connectPromise = null;
            resolve();
          },
          reject: (error) => {
            this.pending.delete(authId);
            fail(error.message || "remote backend auth failed");
          },
        });

        try {
          ws.send(
            JSON.stringify({
              id: authId,
              method: "auth",
              params: { token: this.token },
            }),
          );
        } catch (error) {
          this.pending.delete(authId);
          fail(error instanceof Error ? error.message : String(error));
        }
      };

      ws.onmessage = (event) => {
        this.handleIncoming(event.data);
      };

      ws.onerror = () => {
        if (!settled) {
          fail("Failed to connect to remote backend websocket.");
        }
      };

      ws.onclose = () => {
        this.ws = null;
        this.connectPromise = null;
        this.flushPending("remote backend disconnected");
      };
    });

    return this.connectPromise;
  }

  private handleIncoming(data: unknown) {
    const text =
      typeof data === "string"
        ? data
        : data instanceof Blob
          ? null
          : data instanceof ArrayBuffer
            ? new TextDecoder().decode(data)
            : null;

    if (text === null) {
      return;
    }

    for (const line of text
      .split("\n")
      .map((entry) => entry.trim())
      .filter(Boolean)) {
      const parsed = this.parseIncomingLine(line);
      if (!parsed) {
        continue;
      }

      if (parsed.type === "notification") {
        this.notificationHandler?.(parsed.method, parsed.params);
        continue;
      }

      const pending = this.pending.get(parsed.id);
      if (!pending) {
        continue;
      }
      this.pending.delete(parsed.id);
      if (parsed.error) {
        pending.reject(toError(parsed.error));
      } else {
        pending.resolve(parsed.result);
      }
    }
  }

  private parseIncomingLine(line: string):
    | { type: "notification"; method: string; params: unknown }
    | { type: "response"; id: number; result: unknown; error: string | null }
    | null {
    let payload: unknown;
    try {
      payload = JSON.parse(line);
    } catch {
      return null;
    }

    if (!payload || typeof payload !== "object") {
      return null;
    }

    const value = payload as {
      id?: unknown;
      method?: unknown;
      params?: unknown;
      result?: unknown;
      error?: unknown;
    };

    if (typeof value.id === "number") {
      const error = value.error ? parseErrorMessage(value.error) : null;
      return {
        type: "response",
        id: value.id,
        result: value.result,
        error,
      };
    }

    if (typeof value.method === "string") {
      return {
        type: "notification",
        method: value.method,
        params: value.params,
      };
    }

    return null;
  }

  private flushPending(message: string) {
    const error = toError(message);
    for (const pending of this.pending.values()) {
      pending.reject(error);
    }
    this.pending.clear();
  }
}
