let _csrfPromise: Promise<string> | null = null;

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
