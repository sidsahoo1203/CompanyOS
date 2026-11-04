import { AuthForm } from "@/components/auth-form";
export const metadata = { title: "Create account" };
export default function SignUp() {
  return (
    <>
      <p className="eyebrow">GET STARTED</p>
      <h1>Create your account</h1>
      <p className="muted intro">Set up your agency’s shared workspace.</p>
      <AuthForm mode="sign-up" />
      <p className="hint footnote">
        Local accounts only. Email verification is not connected.
      </p>
    </>
  );
}
