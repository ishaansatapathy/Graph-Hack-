import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Stackfox — coordination layer for AI coding agents",
  description:
    "Git merged it. CI passed. Production would have broken. Stackfox models every agent's pending change as a graph in FalkorDB and catches the incompatibility before merge.",
};

export const viewport: Viewport = {
  themeColor: "#07080a",
  colorScheme: "dark",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="antialiased">
      <body className="min-h-dvh bg-bg text-fg">{children}</body>
    </html>
  );
}
