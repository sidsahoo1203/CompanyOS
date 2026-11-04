import Link from "next/link";
import { ResetPasswordForm } from "@/components/password-forms";
export const metadata = { title: "Choose a new password" };
export const dynamic = "force-dynamic";
export default async function ResetPassword({
  searchParams,
}: {
  searchParams: Promise<{ token?: string | string[]; error?: string }>;
}) {
  const { token, error } = await searchParams;
  // The emailed link passes through /api/auth/reset-password/<token>, which
  // redirects here with ?token=… or, for an expired/used link, ?error=….
  const valid =
    !error && typeof token === "string" && /^[A-Za-z0-9_-]{8,200}$/.test(token);
  return (
    <>
      <p className="eyebrow">ACCOUNT RECOVERY</p>
      <h1>Choose a new password</h1>
      {valid ? (
        <ResetPasswordForm token={token} />
      ) : (
        <div className="stack">
          <p role="alert" className="notice error">
            This reset link is invalid, already used, or expired.
          </p>
          <Link className="button" href="/forgot-password">
            Request a new link
          </Link>
        </div>
      )}
    </>
  );
}
