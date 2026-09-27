import { LoginForm } from "./LoginForm";
import { BRAND } from "@/lib/brand";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-5 py-16">
      {/* eslint-disable-next-line @next/next/no-img-element -- a local mark needs no optimiser */}
      <img src={BRAND.logo} alt={BRAND.schoolName} width={72} height={72} className="brand-mark mb-5 p-1" />
      <p className="label" style={{ color: "var(--brand-ink)" }}>{BRAND.schoolName} · daily capture</p>
      <h1 className="mt-2 text-3xl font-bold tracking-tight">Sign in</h1>
      <p className="mt-2 text-[15px] leading-relaxed" style={{ color: "var(--muted)" }}>
        Use your school email and temporary password. No email link is required.
      </p>
      <LoginForm next={next ?? "/"} />
    </main>
  );
}
