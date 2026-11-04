import { expect, type APIRequestContext } from "@playwright/test";
// Local sign-ups share one loopback rate-limit bucket (10 per minute). The suite
// creates more accounts than that, so wait out the server's window instead of
// weakening the limit for tests.
export async function signUp(
  context: APIRequestContext,
  data: { name: string; email: string; password: string },
  headers: Record<string, string> = {},
) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await context.post("/api/auth/sign-up/email", {
      headers,
      data,
    });
    if (response.status() !== 429) {
      expect(response.status()).toBe(200);
      return response;
    }
    const wait = Number(response.headers()["x-retry-after"] ?? "60");
    await new Promise((resolve) =>
      setTimeout(resolve, (Math.min(Math.max(wait, 1), 65) + 1) * 1000),
    );
  }
  throw new Error("Sign-up stayed rate limited after waiting one window.");
}
