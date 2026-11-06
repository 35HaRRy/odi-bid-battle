import { API_BASE, apiRequest } from "./api-transport";
export { setSessionCsrf, subscribeUnauthorized } from "./api-transport";

export interface AuthUser { id: string; username: string; email: string }
export interface SessionView {
  user: AuthUser | null;
  csrfToken: string;
  googleEnabled: boolean;
  mailEnabled: boolean;
}

function post(path: string, body: unknown = {}): Promise<Response> {
  return apiRequest(`/auth/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// Return views without installing credentials: the session owner rejects stale results.
export const authApi = {
  async session(): Promise<SessionView> {
    return (await apiRequest("/auth/session")).json();
  },
  async login(login: string, password: string): Promise<SessionView> {
    return (await post("login", { login, password })).json();
  },
  async register(input: { username: string; email: string; password: string }): Promise<void> {
    await post("register", input);
  },
  async logout(): Promise<void> { await post("logout"); },
  async forgotPassword(email: string): Promise<void> { await post("forgot-password", { email }); },
  async resetPassword(token: string, password: string): Promise<void> { await post("reset-password", { token, password }); },
  async verifyEmail(token: string): Promise<void> { await post("verify-email", { token }); },
  async resendVerification(email: string): Promise<void> { await post("resend-verification", { email }); },
  async reauthenticate(password: string): Promise<void> { await post("reauthenticate", { password }); },
  googleStartUrl: (returnTo = "/") => `${API_BASE}/auth/google/start?${new URLSearchParams({ returnTo })}`,
  async linkGoogle(returnTo = "/"): Promise<{ url: string }> {
    return (await post("google/link", { returnTo })).json();
  },
};
