import { AuthCard } from "~/components/auth-card";

type SignInPageProps = {
  searchParams: Promise<{ error?: string; next?: string }>;
};

export default async function SignInPage({ searchParams }: SignInPageProps) {
  const params = await searchParams;
  const errorMessage = params.error ?? undefined;
  const nextPath = params.next ?? undefined;

  return (
    <div className="thread-auth-screen">
      <main className="thread-auth-screen-main">
        <AuthCard errorMessage={errorMessage} nextPath={nextPath} />
      </main>
    </div>
  );
}
