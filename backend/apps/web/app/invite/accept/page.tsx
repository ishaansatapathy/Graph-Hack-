import type { Metadata } from "next";
import { Suspense } from "react";

import { InviteAccept } from "./invite-accept";

export const metadata: Metadata = {
  title: "Accept invitation · Stackfox",
  description: "Join your team's Stackfox workspace.",
  robots: { index: false, follow: false },
};

export default function InviteAcceptPage() {
  return (
    <div className="thread-auth-screen">
      <main className="thread-auth-screen-main">
        <Suspense fallback={<div className="invite-card invite-skeleton" aria-busy="true" />}>
          <InviteAccept />
        </Suspense>
      </main>
    </div>
  );
}
