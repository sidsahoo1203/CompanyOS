import { AuthForm } from "@/components/auth-form";
import { hostedMode } from "@/lib/mode";
export const metadata = { title: "Create account" };
export default async function SignUp() {
  const hosted = await hostedMode();
  return (
    <>
      <p className="eyebrow">GET STARTED</p>
      <h1>Create your account</h1>
      <p className="muted intro">Set up your agency’s shared workspace.</p>
      <AuthForm mode="sign-up" verifyEmail={hosted} />
      <p className="hint footnote">
        {hosted
          ? "We will email you a link to verify your address before you can sign in."
          : "Local accounts only. Email verification is used on hosted deployments."}
      </p>
    </>
  );
}
