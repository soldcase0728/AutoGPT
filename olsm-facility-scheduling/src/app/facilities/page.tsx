import type { Metadata } from "next";
import Link from "next/link";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { PublicShell } from "@/components/app-shell";
import { Badge, Card, EmptyState, Field, PageHeader, inputClass } from "@/components/ui";

export const metadata: Metadata = {
  title: "Facility directory",
  robots: { index: false },
};

/**
 * Rendered per request, not prerendered at build time.
 *
 * This page reads facilities from the database. Static prerendering would bake
 * the directory into the build -- so a facility added or renamed in the admin
 * UI would never appear -- and would require a reachable database during
 * `docker build`, which there isn't one.
 */
export const dynamic = "force-dynamic";

interface Filters {
  q?: string;
  setting?: string;
  access?: string;
  capacity?: string;
}

/** Whether anything is actually narrowing the list, for the clear action. */
function isFiltered(filters: Filters): boolean {
  return Boolean(filters.q || filters.setting || filters.access || filters.capacity);
}

export default async function FacilitiesPage({
  searchParams,
}: {
  searchParams: Promise<Filters>;
}) {
  const filters = await searchParams;

  const q = filters.q?.trim() ?? "";
  const minCapacity = Number.parseInt(filters.capacity ?? "", 10);

  // Filtering happens in the query rather than in the page, so "no results"
  // means no results rather than an empty grid below a full count. Every clause
  // is omitted when its control is untouched.
  const where: Prisma.FacilityWhereInput = {
    active: true,
    ...(filters.setting === "indoor" ? { indoor: true } : {}),
    ...(filters.setting === "outdoor" ? { indoor: false } : {}),
    ...(filters.access === "external" ? { externallyBookable: true } : {}),
    ...(filters.access === "school" ? { externallyBookable: false } : {}),
    ...(Number.isFinite(minCapacity) && minCapacity > 0 ? { capacity: { gte: minCapacity } } : {}),
    ...(q
      ? {
          OR: [
            { name: { contains: q, mode: "insensitive" } },
            { type: { contains: q, mode: "insensitive" } },
            { description: { contains: q, mode: "insensitive" } },
            { amenities: { has: q } },
            { subSpaces: { some: { name: { contains: q, mode: "insensitive" } } } },
          ],
        }
      : {}),
  };

  const [facilities, totalActive] = await Promise.all([
    prisma.facility.findMany({
      where,
      include: { subSpaces: { where: { active: true }, orderBy: { sortOrder: "asc" } } },
      orderBy: { name: "asc" },
    }),
    prisma.facility.count({ where: { active: true } }),
  ]);

  return (
    <PublicShell>
      <PageHeader
        title="Athletic facilities"
        description="Orchard Lake St. Mary's Preparatory athletic spaces available for school and community use."
      />

      {/*
        A plain GET form. Filter state lives in the URL, so a filtered directory
        can be linked, bookmarked and reloaded, the back button behaves, and the
        whole thing works before any JavaScript arrives.
      */}
      <Card className="mb-5">
        <form method="get" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="sm:col-span-2">
            <Field label="Search" htmlFor="q" hint="Name, type, amenity or space">
              <input
                id="q"
                name="q"
                type="search"
                defaultValue={filters.q ?? ""}
                placeholder="Gym, turf, batting cages…"
                className={inputClass}
              />
            </Field>
          </div>

          <Field label="Indoor or outdoor" htmlFor="setting">
            <select id="setting" name="setting" defaultValue={filters.setting ?? ""} className={inputClass}>
              <option value="">Either</option>
              <option value="indoor">Indoor</option>
              <option value="outdoor">Outdoor</option>
            </select>
          </Field>

          <Field label="Who can book" htmlFor="access">
            <select id="access" name="access" defaultValue={filters.access ?? ""} className={inputClass}>
              <option value="">Anyone</option>
              <option value="external">Open to outside groups</option>
              <option value="school">School use only</option>
            </select>
          </Field>

          <Field label="Minimum capacity" htmlFor="capacity">
            <input
              id="capacity"
              name="capacity"
              type="number"
              min={1}
              step={25}
              defaultValue={filters.capacity ?? ""}
              placeholder="Any"
              className={inputClass}
            />
          </Field>

          <div className="flex items-end gap-2 sm:col-span-2 lg:col-span-3">
            <button
              type="submit"
              className="rounded-md bg-navy-800 px-3.5 py-2 text-sm font-medium text-white hover:bg-navy-700"
            >
              Apply filters
            </button>
            {isFiltered(filters) && (
              <Link
                href="/facilities"
                className="rounded-md border border-navy-300 px-3.5 py-2 text-sm font-medium text-navy-800 hover:bg-navy-50"
              >
                Clear filters
              </Link>
            )}
          </div>
        </form>
      </Card>

      {/*
        Announced politely so a screen-reader user who submits the form hears
        how many facilities came back, rather than having to go looking.
      */}
      <p aria-live="polite" className="mb-3 text-sm text-navy-700">
        {isFiltered(filters)
          ? `Showing ${facilities.length} of ${totalActive} facilities.`
          : `${totalActive} facilities.`}
      </p>

      {facilities.length === 0 ? (
        <EmptyState title="No facilities match those filters">
          <p className="mt-1 text-sm text-navy-700">
            Try a wider search, a lower capacity, or clear the filters to see all {totalActive}.
          </p>
          <p className="mt-3">
            <Link href="/facilities" className="text-sm font-medium text-navy-800 underline">
              Clear filters
            </Link>
          </p>
        </EmptyState>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2">
          {facilities.map((facility) => (
            <li key={facility.id}>
              <Card
                className="h-full"
                title={
                  <Link href={`/facilities/${facility.slug}`} className="hover:underline">
                    {facility.name}
                  </Link>
                }
                description={facility.type}
              >
                <p className="text-sm text-navy-700">{facility.description}</p>

                <div className="mt-3 flex flex-wrap gap-2">
                  <Badge>{facility.indoor ? "Indoor" : "Outdoor"}</Badge>
                  <Badge>Capacity {facility.capacity.toLocaleString()}</Badge>
                  {facility.externallyBookable ? (
                    <Badge tone="good">Available to outside groups</Badge>
                  ) : (
                    <Badge tone="warn">School use only</Badge>
                  )}
                  {facility.requiresSupervision && <Badge tone="warn">Supervision required</Badge>}
                  {facility.weatherDependent && <Badge tone="warn">Weather dependent</Badge>}
                </div>

                <p className="mt-3 text-sm text-navy-600">
                  {facility.subSpaces.length} bookable space
                  {facility.subSpaces.length === 1 ? "" : "s"}:{" "}
                  {facility.subSpaces.map((s) => s.name).join(", ")}
                </p>

                <p className="mt-3">
                  <Link
                    href={`/facilities/${facility.slug}`}
                    className="text-sm font-medium underline"
                  >
                    {facility.externallyBookable
                      ? "Rates and availability"
                      : "Details and availability"}
                  </Link>
                </p>
              </Card>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-6">
        <Card title="Want to book one of these?">
          <p className="text-sm text-navy-700">
            Outside organizations, clubs and travel teams can submit a request without an OLSM
            account. Requests go through approval, a facility use agreement, a liability waiver, a
            certificate of insurance and payment before they are confirmed.
          </p>
          <Link
            href="/request"
            className="mt-3 inline-block rounded-md bg-navy-800 px-3.5 py-2 text-sm font-medium text-white hover:bg-navy-700"
          >
            Request a facility
          </Link>
        </Card>
      </div>
    </PublicShell>
  );
}
