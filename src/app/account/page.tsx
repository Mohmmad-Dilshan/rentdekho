import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "../../server/auth/authorization";
import { SignOutButton } from "./sign-out-button";

export default async function AccountPage() {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/sign-in");
  }

  return (
    <main>
      <h1>Account</h1>
      <p>Signed in as {user.name}.</p>
      {user.role === "OWNER" || user.role === "BROKER" ? (
        <p>
          <Link className="text-link" href="/my/listings">
            Manage my listings
          </Link>
        </p>
      ) : null}
      <SignOutButton />
    </main>
  );
}
