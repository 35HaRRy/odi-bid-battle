export const API_BASE =
  (import.meta as unknown as { env: Record<string, string> }).env
    .VITE_API_URL ?? "http://localhost:3001";

export class ApiError extends Error {
  constructor(public status: number, message: string, public details?: unknown) {
    super(message);
  }
}

let csrfToken = "";
let sessionVersion = 0;
const unauthorizedListeners = new Set<() => void>();

// The session owner installs accepted views; every call invalidates older requests.
export function setSessionCsrf(token: string): void {
  csrfToken = token;
  sessionVersion++;
}

export function subscribeUnauthorized(listener: () => void): () => void {
  unauthorizedListeners.add(listener);
  return () => { unauthorizedListeners.delete(listener); };
}

export async function apiRequest(path: string, init: RequestInit = {}): Promise<Response> {
  const version = sessionVersion;
  const headers = new Headers(init.headers);
  if (!["GET", "HEAD", "OPTIONS"].includes((init.method ?? "GET").toUpperCase())) {
    headers.set("X-CSRF-Token", csrfToken);
  }
  const res = await fetch(`${API_BASE}${path}`, { ...init, credentials: "include", headers });
  const assertCurrent = () => {
    if (version !== sessionVersion) throw new DOMException("Session changed", "AbortError");
  };
  assertCurrent();
  if (!res.ok) {
    const body = await res.clone().json().catch(() => null);
    const text = body ? "" : await res.text().catch(() => "");
    assertCurrent();
    if (res.status === 401) {
      for (const listener of unauthorizedListeners) listener();
    }
    if (body && typeof body === "object") {
      throw new ApiError(res.status, body.error ?? `http ${res.status}`, body);
    }
    // Platforms may reject the body before the app runs, returning HTML/text 413.
    throw new ApiError(res.status, res.status === 413 ? "payload too large" : text || `http ${res.status}`, null);
  }
  const json = res.json.bind(res);
  res.json = async () => {
    const value: unknown = await json();
    assertCurrent();
    return value;
  };
  return res;
}
