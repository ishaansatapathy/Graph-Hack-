import { redirect } from "next/navigation";

export default function SharePage() {
  redirect("/app?tab=vault");
}
