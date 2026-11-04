import { AuthForm } from "@/components/auth-form";
export const metadata = { title: "Sign in" };
export default function SignIn() {
  return (
    <>
      <p className="eyebrow">WELCOME BACK</p>
      <h1>Sign in</h1>
      <p className="muted intro">Continue to your agency workspace.</p>
      <AuthForm mode="sign-in" />
      <p className="hint footnote">
        Password recovery is not available in this local milestone.
      </p>
    </>
  );
}
