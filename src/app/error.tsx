"use client";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main id="main" className="narrow-page">
      <section className="panel">
        <h1>We couldn’t load this page.</h1>
        <p>
          Try again. If this continues, check that the local database is
          running.
        </p>
        <button className="button" onClick={reset}>
          Try again
        </button>
      </section>
    </main>
  );
}
