import type { ReactNode } from "react";

import { AppLayoutClient } from "~/components/app/app-layout-client";

export default function AppSectionLayout({ children }: { children: ReactNode }) {
  return <AppLayoutClient>{children}</AppLayoutClient>;
}
