import type { Metadata } from "next";
import { Barlow, Barlow_Condensed } from "next/font/google";
import "./globals.css";
import "./nadi.css";

// V2.7a — the Industry design system's pairing (Barlow Condensed headings over Barlow),
// self-hosted at build time via next/font; nadi.css reads these variables as
// --font-heading / --font-body. (Geist shipped unused since scaffolding — removed.)
const barlow = Barlow({
  variable: "--font-barlow",
  weight: ["400", "500", "700"],
  subsets: ["latin"],
});

const barlowCondensed = Barlow_Condensed({
  variable: "--font-barlow-condensed",
  weight: ["400", "600"],
  subsets: ["latin"],
});

const TITLE = "Nadi — arranges evidence; the planner concludes";
const DESCRIPTION =
  "Preview the impact of a proposed street change on a Toronto corridor: SUMO microsimulation, per-stakeholder evidence, simulated reactions.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  // V2.8: the landing page is what a shared link unfurls. No image yet (a hero card needs a
  // designed asset), so the card is text-only by choice.
  openGraph: { title: TITLE, description: DESCRIPTION, type: "website" },
  twitter: { card: "summary", title: TITLE, description: DESCRIPTION },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${barlow.variable} ${barlowCondensed.variable}`}>
      <body>{children}</body>
    </html>
  );
}
