import { redirect } from "next/navigation";

export default function IdePage() {
  redirect("/app?tab=ide");
}
