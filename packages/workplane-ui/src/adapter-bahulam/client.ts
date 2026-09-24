import type { JsonValue } from "../protocol/index.js";

/**
 * Thin client over the Bahulam local service, which a plugin view reaches on
 * the same origin it was served from.
 *
 * Only four surfaces are used, all of which already exist:
 *
 *   POST /api/plugin-state/<plugin>   shared blackboard, ops get|set|patch|...
 *   POST /api/tools/execute           invoke a declared plugin tool
 *   GET  /api/events                  SSE bus, including plugin_state_changed
 *   POST /api/workplane/<plugin>/...  the command boundary, when present
 *
 * Note what is absent: there is no call here that can read plugin config. The
 * local service refuses `getConfig` and the `_config` key to browser views, so
 * credentials cannot reach a Workplane document even by mistake.
 */
export interface BahulamClientOptions {
  plugin: string;
  /** Defaults to the origin the view was served from. */
  baseUrl?: string;
  /**
   * Local workspace access token. The local service authorises EVERY request,
   * so this is required in practice, not optional.
   *
   * Omit it and `fromLocation()` reads it from the panel's own URL, which is
   * where the host puts it.
   */
  token?: string;
  fetchImpl?: typeof fetch;
}

export class BahulamRequestError extends Error {
  readonly status: number;
  readonly code: string | undefined;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "BahulamRequestError";
    this.status = status;
    this.code = code;
  }
}

type StateOp = "get" | "set" | "patch" | "delete" | "keys" | "append" | "list" | "query";

export class BahulamClient {
  readonly plugin: string;
  readonly #baseUrl: string;
  readonly #token: string | undefined;
  readonly #fetch: typeof fetch;

  /**
   * Build a client from the panel's own URL, the way a plugin view is loaded:
   * `/plugin-view/<plugin>/<file>?token=...`.
   */
  static fromLocation(plugin: string, overrides: Partial<BahulamClientOptions> = {}): BahulamClient {
    let token = "";
    try {
      token = new URLSearchParams(location.search).get("token") ?? "";
    } catch {
      /* no location, e.g. under test */
    }
    return new BahulamClient({ plugin, token, ...overrides });
  }

  constructor(options: BahulamClientOptions) {
    this.plugin = options.plugin;
    this.#baseUrl = (options.baseUrl ?? "").replace(/\/$/, "");
    this.#token = options.token;
    this.#fetch = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  }

  #url(path: string): string {
    return `${this.#baseUrl}${path}`;
  }

  #authHeaders(): Record<string, string> {
    return this.#token ? { "x-bahulam-local-token": this.#token } : {};
  }

  async #post<T>(path: string, body: unknown): Promise<T> {
    const response = await this.#fetch(this.#url(path), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        // The header the local service actually checks. A query-string token
        // would also work but ends up in logs, so prefer the header wherever
        // the API allows one.
        ...this.#authHeaders(),
      },
      body: JSON.stringify(body),
    });
    const payload = (await response.json().catch(() => ({}))) as {
      ok?: boolean;
      result?: T;
      error?: string;
      message?: string;
    };
    if (!response.ok || payload.ok === false) {
      throw new BahulamRequestError(
        payload.message ?? payload.error ?? `Request to ${path} failed`,
        response.status,
        payload.error,
      );
    }
    return payload.result as T;
  }

  /** One shared-blackboard operation. */
  async state<T = JsonValue>(op: StateOp, args: Record<string, unknown> = {}): Promise<T> {
    return this.#post<T>(`/api/plugin-state/${encodeURIComponent(this.plugin)}`, { op, ...args });
  }

  async getKey<T = JsonValue>(key: string, fallback: T | null = null): Promise<T | null> {
    return this.state<T | null>("get", { key, fallback });
  }

  async setKey(key: string, value: JsonValue): Promise<void> {
    await this.state("set", { key, value });
  }

  /**
   * Invoke a tool the plugin declared. This is how a Workplane data provider
   * reads real data: the tool reads credentials from plugin config itself, so
   * no secret passes through the browser or the document.
   */
  async executeTool<T = unknown>(name: string, args: Record<string, unknown> = {}): Promise<T> {
    const response = await this.#fetch(this.#url("/api/tools/execute"), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...this.#authHeaders(),
      },
      body: JSON.stringify({ name, args }),
    });
    const payload = (await response.json().catch(() => ({}))) as {
      ok?: boolean;
      result?: T;
      error?: string;
    };
    if (!response.ok || payload.ok === false) {
      throw new BahulamRequestError(payload.error ?? `Tool ${name} failed`, response.status);
    }
    return payload.result as T;
  }

  /**
   * Subscribe to the host event bus. Returns an unsubscribe function.
   * Reconnection is the caller's concern; `EventSource` retries on its own.
   */
  subscribeEvents(
    onEvent: (name: string, data: unknown) => void,
    names: readonly string[] = ["plugin_state_changed"],
  ): () => void {
    if (typeof EventSource === "undefined") {
      return () => undefined;
    }
    const url = this.#token
      ? this.#url(`/api/events?token=${encodeURIComponent(this.#token)}`)
      : this.#url("/api/events");
    const source = new EventSource(url);
    const listeners: Array<[string, (event: MessageEvent) => void]> = [];

    for (const name of names) {
      const listener = (event: MessageEvent) => {
        let data: unknown = event.data;
        try {
          data = JSON.parse(event.data as string);
        } catch {
          /* a non-JSON payload is passed through as-is */
        }
        onEvent(name, data);
      };
      source.addEventListener(name, listener as EventListener);
      listeners.push([name, listener]);
    }

    return () => {
      for (const [name, listener] of listeners) {
        source.removeEventListener(name, listener as EventListener);
      }
      source.close();
    };
  }

  /** Is the dedicated command boundary available on this host? */
  async supportsCommandBoundary(): Promise<boolean> {
    try {
      const response = await this.#fetch(
        this.#url(`/api/workplane/${encodeURIComponent(this.plugin)}`),
        { method: "GET", headers: this.#authHeaders() },
      );
      return response.status !== 404;
    } catch {
      return false;
    }
  }

  async get<T>(path: string): Promise<T> {
    const response = await this.#fetch(this.#url(path), { headers: this.#authHeaders() });
    const payload = (await response.json().catch(() => ({}))) as {
      ok?: boolean;
      result?: T;
      error?: string;
      message?: string;
    };
    if (!response.ok || payload.ok === false) {
      throw new BahulamRequestError(
        payload.message ?? payload.error ?? `Request to ${path} failed`,
        response.status,
        payload.error,
      );
    }
    return (payload.result ?? (payload as unknown)) as T;
  }

  async post<T>(path: string, body: unknown): Promise<T> {
    return this.#post<T>(path, body);
  }
}
