"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

import { AppShell } from "~/components/app/app-shell";
import { featureFromPath } from "~/lib/app-features";
import { trpc } from "~/lib/trpc";

type Workspace = {
  id: string;
  name: string;
  slug: string;
  role: string;
};

export function AppLayoutClient({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const feature = featureFromPath(pathname);

  const [me, setMe] = useState<{ fullName: string; email: string } | null>(null);
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const user = await trpc.auth.me.query({});
      setMe({ fullName: user.fullName, email: user.email });
      const ws = await trpc.workspace.current.query({});
      setWorkspace(ws);
    } catch {
      setMe(null);
      setWorkspace(null);
      router.replace("/sign-in");
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    void load();
  }, [load]);

  async function onLogout() {
    await trpc.auth.logout.mutate({});
    window.location.href = "/sign-in";
  }

  if (loading) {
    return (
      <div className="app-shell">
        <div className="app-card">Loading…</div>
      </div>
    );
  }

  if (!me || !workspace) {
    return (
      <div className="app-shell">
        <div className="app-card">
          <h1>Sign in required</h1>
          <p>
            <Link href="/sign-in">Go to sign in</Link>
          </p>
        </div>
      </div>
    );
  }

  return (
    <AppShell
      activeId={feature.id}
      userName={me.fullName}
      userEmail={me.email}
      onLogout={() => void onLogout()}
    >
      {children}
    </AppShell>
  );
}
