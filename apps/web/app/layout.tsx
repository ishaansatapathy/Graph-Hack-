import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Graph Hack",
  description: "FalkorDB GraphRAG — WeMakeDevs hackathon",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
