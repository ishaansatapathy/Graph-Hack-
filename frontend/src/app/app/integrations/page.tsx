import { redirect } from "next/navigation";

export default function IntegrationsPage() {
  redirect("/app?tab=integrations");
}
