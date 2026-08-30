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

export const metadata: Metadata = {
  title: "Nadi — arranges evidence; the planner concludes",
  description:
    "Preview the impact of a proposed street change on a Toronto corridor: SUMO microsimulation, per-stakeholder evidence, simulated reactions.",
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
