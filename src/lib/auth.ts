import "server-only";
import { betterAuth } from "better-auth";
import { authPool } from "./db";
import { env } from "./env";
import { logEvent, redact } from "./log";
function createAuth() {
  const config = env();
  return betterAuth({
    appName: "CompanyOS",
    baseURL: config.BETTER_AUTH_URL,
    secret: config.BETTER_AUTH_SECRET,
    trustedOrigins: [config.BETTER_AUTH_URL],
    database: authPool(),
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 12,
      maxPasswordLength: 128,
    },
    session: {
      expiresIn: 604800,
      updateAge: 86400,
      cookieCache: { enabled: false },
    },
    rateLimit: {
      enabled: true,
      storage: "database",
      window: 60,
      max: 100,
      customRules: {
        "/sign-in/email": { window: 60, max: 10 },
        "/sign-up/email": { window: 60, max: 10 },
      },
    },
    advanced: { ipAddress: { ipAddressHeaders: ["x-companyos-client-ip"] } },
    // Library warnings/errors go through the redacting logger; extra
    // arguments (which can include request data) are deliberately dropped.
    logger: {
      level: "warn",
      log: (level, message) =>
        logEvent(level === "error" ? "error" : "warn", "auth.library", {
          message: redact(message),
        }),
    },
  });
}
let instance: ReturnType<typeof createAuth> | undefined;
export function getAuth() {
  return (instance ??= createAuth());
}
