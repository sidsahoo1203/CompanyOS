import { config } from "dotenv";
import { getAuth } from "../src/lib/auth";
import { authPool, tenantPool } from "../src/lib/db";
import {
  createWorkspace,
  listWorkspaces,
  getWorkspace,
  inviteMember,
  acceptInvitation,
} from "../src/lib/workspaces";
config({ path: ".env.local", quiet: true });
if (process.env.NODE_ENV === "production" || process.env.APP_MODE !== "local")
  throw new Error("Seed is restricted to local development.");
if (new URL(process.env.DATABASE_URL ?? "").pathname !== "/companyos_dev")
  throw new Error("Seed requires companyos_dev.");
const password = process.env.SEED_PASSWORD;
if (!password || password.length < 16)
  throw new Error("Generate a local SEED_PASSWORD with npm run db:local.");
async function user(name: string, email: string) {
  const existing = await authPool().query<{ id: string }>(
    'SELECT id FROM public."user" WHERE email=$1',
    [email],
  );
  if (existing.rows[0]) return existing.rows[0].id;
  const result = await getAuth().api.signUpEmail({
    body: { name, email, password: password! },
  });
  return result.user.id;
}
try {
  const owner = await user("Alex Morgan", "founder@studio.example");
  const admin = await user("Sam Rivera", "admin@studio.example");
  const member = await user("Jordan Lee", "member@studio.example");
  const other = await user("Taylor Chen", "founder@other.example");
  const input = {
    name: "Northstar Studio · Sample",
    industry: "Digital agency",
    timezone: "UTC",
    language: "en" as const,
    retentionDays: 90 as const,
  };
  let workspace = (await listWorkspaces(owner)).find(
    (item) => item.name === input.name,
  )?.id;
  workspace ??= await createWorkspace(owner, input);
  for (const [id, email, role] of [
    [admin, "admin@studio.example", "admin"],
    [member, "member@studio.example", "member"],
  ] as const) {
    if (
      !(await getWorkspace(owner, workspace)).members.some(
        (item) => item.user_id === id,
      )
    ) {
      const invitation = await inviteMember(owner, workspace, email, role);
      await acceptInvitation(id, invitation.token);
    }
  }
  if (!(await listWorkspaces(other)).length)
    await createWorkspace(other, {
      ...input,
      name: "Separate Agency · Sample",
    });
  console.log(
    "Synthetic seed ready: founder@studio.example, admin@studio.example, member@studio.example, founder@other.example.",
  );
  console.log(
    "The shared LOCAL-ONLY seed password is SEED_PASSWORD in ignored .env.local. No email was sent.",
  );
} finally {
  await authPool().end();
  await tenantPool().end();
}
