import { LoginForm } from "./LoginForm";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-5 py-16">
      <p className="label">Northside · daily capture</p>
      <h1 className="mt-2 text-3xl font-bold tracking-tight">Sign in</h1>
      <p className="mt-2 text-[15px] leading-relaxed" style={{ color: "var(--muted)" }}>
        Use your school email and temporary password. No email link is required.
      </p>
      <LoginForm next={next ?? "/"} />
    </main>
  );
}
