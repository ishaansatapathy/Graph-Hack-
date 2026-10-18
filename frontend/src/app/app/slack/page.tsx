import { redirect } from "next/navigation";

export default function SlackPage() {
  redirect("/app?tab=integrations");
}
