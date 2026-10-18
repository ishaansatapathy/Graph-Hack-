import { redirect } from "next/navigation";

export default function JiraPage() {
  redirect("/app?tab=integrations");
}
