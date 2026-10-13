import type { Metadata } from "next";
import "./second-look.css";

export const metadata: Metadata = {
  title: "Second Look",
  description: "A guardian co-signs big or unusual transfers on her Ledger. Lumi, an AI agent, explains the risk but can never sign.",
  icons: { icon: "/icon.svg" },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Newsreader:opsz,wght@6..72,300..600&family=Instrument+Sans:wght@400..700&display=swap" />
      </head>
      <body>{children}</body>
    </html>
  );
}
