let _csrfPromise: Promise<string> | null = null;
let _fetchInterceptorInstalled = false;

function resolveFetchUrlAndMethod(
  input: RequestInfo | URL,
  init?: RequestInit
): { url: string; method: string } {
  if (input instanceof Request) {
    return {
      url: input.url,
      method: (init?.method ?? input.method ?? "GET").toUpperCase(),
    };
  }
  if (typeof input === "string") {
    return { url: input, method: (init?.method ?? "GET").toUpperCase() };
  }
  if (input instanceof URL) {
    return { url: input.href, method: (init?.method ?? "GET").toUpperCase() };
  }
  return { url: input.url, method: (init?.method ?? "GET").toUpperCase() };
}

/**
 * Monkey-patch `fetch` so same-origin mutating requests automatically send
 * `X-Frappe-CSRF-Token`. Call once after `ensureCSRFToken()` resolves.
 */
export function installFetchCSRFInterceptor(): void {
  if (typeof window === "undefined" || _fetchInterceptorInstalled) return;
  _fetchInterceptorInstalled = true;

  const originalFetch = window.fetch.bind(window);

  window.fetch = function patchedFetch(
    input: RequestInfo | URL,
    init?: RequestInit
  ): Promise<Response> {
    const { url, method } = resolveFetchUrlAndMethod(input, init);

    if (method !== "GET" && method !== "HEAD") {
      const isSameOrigin =
        url.startsWith("/") || url.startsWith(window.location.origin);

      if (isSameOrigin) {
        const token = window.csrf_token ?? "";
        if (token) {
          const headers = new Headers(init?.headers);
          if (!headers.has("X-Frappe-CSRF-Token")) {
            headers.set("X-Frappe-CSRF-Token", token);
          }
          init = { ...init, headers };
        }
      }
    }

    return originalFetch(input, init);
  };
}

export function getCSRFToken(): string | null {
  return typeof window !== "undefined" ? window.csrf_token ?? null : null;
}

export async function ensureCSRFToken(): Promise<string> {
  if (typeof window === "undefined") return "";

  const existing = window.csrf_token;
  if (existing && !existing.includes("{{")) return existing;

  if (!_csrfPromise) {
    _csrfPromise = fetch("/api/method/klik_pos.api.user.get_spa_csrf_token", {
      method: "GET",
      credentials: "include",
      headers: { Accept: "application/json" },
    })
      .then((res) => res.json())
      .then((data) => {
        const token = (data?.message as string) ?? "";
        window.csrf_token = token;
        return token;
      })
      .catch(() => {
        _csrfPromise = null;
        return "";
      });
  }

  return _csrfPromise;
}

/** POST JSON to /api/method/* with CSRF (required by Frappe for mutating/session requests). */
export async function frappeJsonPostInit(body: unknown): Promise<RequestInit> {
  await ensureCSRFToken();
  const token = getCSRFToken() ?? "";
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["X-Frappe-CSRF-Token"] = token;
  return {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    credentials: "include",
  };
}
