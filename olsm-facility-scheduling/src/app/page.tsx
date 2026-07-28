import { redirect } from "next/navigation";
import { Role } from "@prisma/client";
import { getCurrentUser } from "@/lib/auth/current-user";

/** Send everyone to the screen that is actually useful to their role. */
export default async function HomePage() {
  const user = await getCurrentUser();

  if (!user) redirect("/facilities");

  switch (user.role) {
    case Role.FACILITIES:
      redirect("/custodial");
    case Role.FINANCE:
      redirect("/admin/reports");
    case Role.EXTERNAL:
      redirect("/portal");
    default:
      redirect("/calendar");
  }
}
