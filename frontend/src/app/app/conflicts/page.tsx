import { redirect } from "next/navigation";

export default function ConflictsPage() {
  redirect("/app?tab=conflicts");
}
