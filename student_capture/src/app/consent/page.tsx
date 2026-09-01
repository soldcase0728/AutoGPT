import { redirect } from "next/navigation";
import { ConsentView } from "@/components/views/ConsentView";
import { hasSignedRelease, requirePerson } from "@/lib/session";
import { ConsentForm } from "./ConsentForm";
import { RELEASE_VERSION } from "./version";

export const dynamic = "force-dynamic";

export default async function ConsentPage() {
  const person = await requirePerson();
  if (await hasSignedRelease(person.id, RELEASE_VERSION)) redirect("/");

  const ageUnknown = person.birth_year === null;
  const minor = ageUnknown || new Date().getFullYear() - person.birth_year! < 18;

  return (
    <ConsentView
      person={person}
      minor={minor}
      ageUnknown={ageUnknown}
      releaseVersion={RELEASE_VERSION}
    >
      <ConsentForm personId={person.id} displayName={person.display_name} />
    </ConsentView>
  );
}
