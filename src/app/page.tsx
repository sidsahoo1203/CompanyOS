import Link from "next/link";
export default function Home() {
  return (
    <main id="main" className="landing">
      <header className="public-header">
        <Link className="brand" href="/">
          <span className="brand-mark" aria-hidden="true">
            C
          </span>
          CompanyOS
        </Link>
        <Link href="/sign-in" className="button secondary">
          Sign in
        </Link>
      </header>
      <section className="landing-body">
        <p className="eyebrow">A SHARED SPACE FOR YOUR AGENCY</p>
        <h1>
          Good operations
          <br />
          start with your team.
        </h1>
        <p className="lead">
          Bring your people into one workspace, with clear roles and a
          foundation for the way your agency works.
        </p>
        <div className="actions">
          <Link className="button" href="/sign-up">
            Create your workspace
          </Link>
          <Link className="text-link" href="/sign-in">
            Open CompanyOS
          </Link>
        </div>
        <div className="foundation-card">
          <span className="badge">Local development</span>
          <h2>Start with the essentials</h2>
          <p>
            Workspaces, team roles, document search, and cited source excerpts
            are available now, alongside versioned procedures and local draft
            runs. Model integrations and approvals are planned for later
            milestones.
          </p>
          <p className="hint">
            Use fictional data here. No production services are connected.
          </p>
        </div>
      </section>
      <footer>
        CompanyOS <span>Built around human decisions.</span>
      </footer>
    </main>
  );
}
