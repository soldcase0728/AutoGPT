import { redirect } from "next/navigation";

// Media consent is collected by the school before a student is given access,
// so the in-app release form is retired. Old links land on Today.
export default function ConsentPage() {
  redirect("/");
}
