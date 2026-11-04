import Link from "next/link";
import { requireSession } from "@/lib/page-session";
import { JoinForm } from "@/components/join-form";
export const dynamic = "force-dynamic";
export default async function Join() {
  const session = await requireSession();
  return (
    <main id="main" className="narrow-page">
      <Link href="/onboarding" className="brand">
        CompanyOS
      </Link>
      <section className="panel">
        <h1>Join your team</h1>
        <p className="hint">Signed in as {session.user.email}</p>
        <JoinForm />
      </section>
    </main>
  );
}
