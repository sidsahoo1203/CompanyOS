import Link from "next/link";
import { hostedMode } from "@/lib/mode";
export default async function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const hosted = await hostedMode();
  return (
    <div className="auth-layout">
      <aside className="auth-aside">
        <Link className="brand" href="/">
          <span className="brand-mark" aria-hidden="true">
            C
          </span>
          CompanyOS
        </Link>
        <div>
          <p className="eyebrow">YOUR AGENCY, TOGETHER</p>
          <h2>
            A clear place
            <br />
            to begin.
          </h2>
          <p>
            One workspace. Clear responsibilities.
            <br />
            Your team in control.
          </p>
        </div>
        {!hosted && (
          <p className="hint">Local development · Use fictional data</p>
        )}
      </aside>
      <main id="main" className="auth-main">
        <div className="auth-card">{children}</div>
      </main>
    </div>
  );
}
