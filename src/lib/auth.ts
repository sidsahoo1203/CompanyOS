import "server-only";
import { betterAuth } from "better-auth";
import { authPool } from "./db";
import { actionEmail, sendEmail } from "./email";
import { env } from "./env";
import { logEvent, redact } from "./log";
function createAuth() {
  const config = env();
  // Hosted deployments require a verified email before any session exists;
  // local mode has no email provider and keeps instant sign-up.
  const production = config.APP_MODE === "production";
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
      requireEmailVerification: production,
      resetPasswordTokenExpiresIn: 3600,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: ({ user, url }) =>
        sendEmail(
          actionEmail(
            user.email,
            user.name,
            "Reset your CompanyOS password",
            "We received a request to reset your password. The link works once and expires in 1 hour.",
            "Choose a new password",
            url,
            "If you did not ask for this, ignore this email. Your password stays the same.",
          ),
        ),
      // Sign-up answers the same way for new and existing addresses; the
      // owner of an existing address is told instead.
      onExistingUserSignUp: ({ user }) =>
        sendEmail(
          actionEmail(
            user.email,
            user.name,
            "Someone tried to create a CompanyOS account with your email",
            "This email address already has a CompanyOS account, so no new account was created.",
            "Sign in",
            config.BETTER_AUTH_URL + "/sign-in",
            "If this was not you, no action is needed. If you forgot your password, use 'Forgot password?' on the sign-in page.",
          ),
        ),
    },
    emailVerification: {
      sendOnSignUp: production,
      sendOnSignIn: production,
      autoSignInAfterVerification: true,
      expiresIn: 86400,
      sendVerificationEmail: ({ user, url }) =>
        sendEmail(
          actionEmail(
            user.email,
            user.name,
            "Verify your email for CompanyOS",
            "Confirm this is your email address to finish creating your CompanyOS account. The link expires in 24 hours.",
            "Verify email",
            url,
            "If you did not create a CompanyOS account, ignore this email.",
          ),
        ),
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
        "/request-password-reset": { window: 60, max: 5 },
        "/send-verification-email": { window: 60, max: 5 },
        "/reset-password": { window: 60, max: 10 },
      },
    },
    advanced: {
      // Pinned so an ambient NODE_ENV=test or TEST variable cannot disable them.
      disableCSRFCheck: false,
      disableOriginCheck: false,
      useSecureCookies: production,
      // The auth route sets this header itself (see client-ip.ts).
      ipAddress: { ipAddressHeaders: ["x-companyos-client-ip"] },
    },
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
