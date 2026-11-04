import "server-only";
import { z } from "zod";
const schema = z.object({
  APP_MODE: z.literal("local"),
  BETTER_AUTH_URL: z.url(),
  BETTER_AUTH_SECRET: z.string().min(32),
  DATABASE_URL: z.string().startsWith("postgres"),
  AUTH_DATABASE_URL: z.string().startsWith("postgres"),
});
let cached: z.infer<typeof schema> | undefined;
export function env() {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success)
    throw new Error(
      "CompanyOS configuration is missing. Follow README.md for local setup.",
    );
  for (const key of [
    "BETTER_AUTH_URL",
    "DATABASE_URL",
    "AUTH_DATABASE_URL",
  ] as const) {
    if (
      !["localhost", "127.0.0.1"].includes(new URL(parsed.data[key]).hostname)
    )
      throw new Error(
        "CompanyOS currently permits local services only. Public deployment requires the documented release gates.",
      );
  }
  if (
    new URL(parsed.data.DATABASE_URL).username !== "companyos_app" ||
    new URL(parsed.data.AUTH_DATABASE_URL).username !== "companyos_auth"
  )
    throw new Error("Use the restricted CompanyOS runtime database roles.");
  return (cached = parsed.data);
}
