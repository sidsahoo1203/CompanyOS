import { z } from "zod";
export const workspaceSchema = z
  .object({
    name: z.string().trim().min(2).max(80),
    industry: z.string().trim().min(2).max(80),
    timezone: z
      .string()
      .min(1)
      .max(80)
      .refine((value) => {
        try {
          new Intl.DateTimeFormat("en", { timeZone: value });
          return true;
        } catch {
          return false;
        }
      }, "Use an IANA time zone, for example Asia/Kolkata."),
    language: z.literal("en"),
    retentionDays: z.union([z.literal(30), z.literal(90), z.literal(365)]),
  })
  .strict();
export type WorkspaceInput = z.infer<typeof workspaceSchema>;
export const workspaceIdSchema = z.uuid();
export const inviteSchema = z
  .object({
    email: z
      .email()
      .max(254)
      .transform((value) => value.toLowerCase()),
    role: z.enum(["admin", "member"]),
  })
  .strict();
export const roleChangeSchema = z
  .object({
    userId: z.string().min(1).max(128),
    role: z.enum(["admin", "member"]),
  })
  .strict();
export const removeMemberSchema = z
  .object({ userId: z.string().min(1).max(128) })
  .strict();
export const acceptSchema = z
  .object({ token: z.string().regex(/^[a-f0-9]{64}$/) })
  .strict();
