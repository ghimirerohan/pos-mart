let _csrfPromise: Promise<string> | null = null;

export function getCSRFToken(): string | null {
  return typeof window !== "undefined" ? window.csrf_token ?? null : null;
}

export async function ensureCSRFToken(): Promise<string> {
  if (typeof window === "undefined") return "";

  const existing = window.csrf_token;
  if (existing && !existing.includes("{{")) return existing;

  if (!_csrfPromise) {
    _csrfPromise = fetch("/api/method/frappe.auth.get_csrf_token", {
      credentials: "include",
    })
      .then((res) => res.json())
      .then((data) => {
        const token = data?.message ?? "";
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
