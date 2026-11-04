import Link from "next/link";
export default function NotFound() {
  return (
    <main id="main" className="narrow-page">
      <section className="panel">
        <h1>Page unavailable</h1>
        <p>This page doesn’t exist or isn’t available to your account.</p>
        <Link className="button" href="/onboarding">
          Your workspaces
        </Link>
      </section>
    </main>
  );
}
