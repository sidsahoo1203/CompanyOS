import { ForgotPasswordForm } from "@/components/password-forms";
import { hostedMode } from "@/lib/mode";
export const metadata = { title: "Reset password" };
export default async function ForgotPassword() {
  const hosted = await hostedMode();
  return (
    <>
      <p className="eyebrow">ACCOUNT RECOVERY</p>
      <h1>Reset your password</h1>
      <p className="muted intro">
        Enter your account email and we will send you a reset link.
      </p>
      <ForgotPasswordForm local={!hosted} />
    </>
  );
}
