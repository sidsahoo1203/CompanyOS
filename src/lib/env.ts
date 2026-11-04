import "server-only";
import { z } from "zod";
const shared = {
  BETTER_AUTH_URL: z.url(),
  BETTER_AUTH_SECRET: z.string().min(32),
  DATABASE_URL: z.string().startsWith("postgres"),
  AUTH_DATABASE_URL: z.string().startsWith("postgres"),
};
const schema = z.discriminatedUnion("APP_MODE", [
  z.object({ APP_MODE: z.literal("local"), ...shared }),
  // Production adds the transactional email provider used for verification
  // and password reset.
  z.object({
    APP_MODE: z.literal("production"),
    ...shared,
    RESEND_API_KEY: z.string().startsWith("re_").min(10),
    EMAIL_FROM: z.string().min(3).max(200),
  }),
]);
export type AppConfig = z.infer<typeof schema>;
const loopback = ["localhost", "127.0.0.1"];
let cached: AppConfig | undefined;
export function env() {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success)
    throw new Error(
      "CompanyOS configuration is missing. Follow README.md for setup.",
    );
  const config = parsed.data;
  if (config.APP_MODE === "local") {
    for (const key of [
      "BETTER_AUTH_URL",
      "DATABASE_URL",
      "AUTH_DATABASE_URL",
    ] as const) {
      if (!loopback.includes(new URL(config[key]).hostname))
        throw new Error(
          "Local mode permits local services only. Use APP_MODE=production for a hosted deployment.",
        );
    }
  } else {
    // Production cookies are Secure, and api() compares the Origin header with
    // this value, so it must be the bare public https origin.
    const site = new URL(config.BETTER_AUTH_URL);
    if (
      site.protocol !== "https:" ||
      loopback.includes(site.hostname) ||
      site.origin !== config.BETTER_AUTH_URL
    )
      throw new Error(
        "Production requires BETTER_AUTH_URL to be the public https:// origin, with no path or trailing slash.",
      );
  }
  if (
    new URL(config.DATABASE_URL).username !== "companyos_app" ||
    new URL(config.AUTH_DATABASE_URL).username !== "companyos_auth"
  )
    throw new Error("Use the restricted CompanyOS runtime database roles.");
  return (cached = config);
}
