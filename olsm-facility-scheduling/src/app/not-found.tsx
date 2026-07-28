import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-lg px-4 py-16">
      <div className="rounded-lg border border-navy-200 bg-white p-6 shadow-sm">
        <h1 className="text-xl font-semibold text-navy-900">Not found</h1>
        <p className="mt-2 text-sm text-navy-700">
          That page or booking does not exist, or is not visible to your account.
        </p>
        <Link
          href="/"
          className="mt-4 inline-block rounded-md bg-navy-800 px-3.5 py-2 text-sm font-medium text-white hover:bg-navy-700"
        >
          Go home
        </Link>
      </div>
    </div>
  );
}
