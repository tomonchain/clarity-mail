import { LoginForm } from "@/components/auth-forms";

export const instant = false;

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; locked?: string }>;
}) {
  const params = await searchParams;
  const error =
    params.error === "wrong"
      ? "Wrong password."
      : params.error === "rate"
        ? "Too many attempts. Wait a few minutes."
        : params.error === "waking"
          ? "The mailbox is waking up. Try again in a moment."
          : null;
  return <LoginForm error={error} locked={params.locked === "1"} />;
}
