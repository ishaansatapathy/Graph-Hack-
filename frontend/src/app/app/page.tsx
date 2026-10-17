import type { Metadata } from "next";
import { Suspense } from "react";
import { Dashboard } from "@/components/dashboard/Dashboard";

export const metadata: Metadata = { title: "Stackfox — Dashboard" };

export default function AppPage() {
  return (
    <Suspense fallback={<div className="h-dvh bg-bg" />}>
      <Dashboard />
    </Suspense>
  );
}
