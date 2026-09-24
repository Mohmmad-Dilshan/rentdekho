import { redirect } from "next/navigation";
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
      <SignOutButton />
    </main>
  );
}
