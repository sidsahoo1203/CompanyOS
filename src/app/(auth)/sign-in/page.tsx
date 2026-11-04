import { AuthForm } from "@/components/auth-form";
import { hostedMode } from "@/lib/mode";
export const metadata = { title: "Sign in" };
export default async function SignIn() {
  const hosted = await hostedMode();
  return (
    <>
      <p className="eyebrow">WELCOME BACK</p>
      <h1>Sign in</h1>
      <p className="muted intro">Continue to your agency workspace.</p>
      <AuthForm mode="sign-in" verifyEmail={hosted} />
    </>
  );
}
