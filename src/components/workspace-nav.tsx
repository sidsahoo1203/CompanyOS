"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
export function WorkspaceNav({ id }: { id: string }) {
  const pathname = usePathname();
  const base = "/w/" + id;
  return (
    <nav aria-label="Workspace">
      <ul className="nav-list">
        {[
          ["Overview", base, "01"],
          ["Knowledge", base + "/knowledge", "02"],
          ["Assistant", base + "/assistant", "03"],
          ["Procedures", base + "/procedures", "04"],
          ["Approvals", base + "/approvals", "05"],
          ["Members", base + "/members", "06"],
          ["Settings", base + "/settings", "07"],
        ].map(([name, href, number]) => (
          <li key={href}>
            <Link
              href={href}
              aria-current={
                pathname === href ||
                (href !== base && pathname.startsWith(href + "/"))
                  ? "page"
                  : undefined
              }
            >
              <span aria-hidden="true" className="nav-number">
                {number}
              </span>
              {name}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
