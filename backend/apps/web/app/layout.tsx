import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Stackfox | Real-Time Knowledge Graph & Vectorless GraphRAG for Engineering Teams",
  description:
    "Production-grade code intelligence, conflict detection, and team knowledge graph platform powered by FalkorDB and Neon PostgreSQL.",
  icons: {
    icon: "/favicon.ico",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
