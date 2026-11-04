export const dynamic = "force-dynamic";
import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: { default: "CompanyOS", template: "%s · CompanyOS" },
  description: "A shared operating space for your agency.",
  icons: { icon: "/favicon.svg" },
  robots: { index: false, follow: false },
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <a href="#main" className="skip-link">
          Skip to content
        </a>
        {children}
      </body>
    </html>
  );
}
