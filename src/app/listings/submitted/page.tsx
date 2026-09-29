import { redirect } from "next/navigation";
import Link from "next/link";
import {
  AuthenticationRequiredError,
  getCurrentUser,
} from "../../../server/auth/authorization";

export default async function ListingSubmittedPage() {
  let canManageListings = false;
  try {
    const user = await getCurrentUser();
    if (!user) throw new AuthenticationRequiredError();
    canManageListings = user.role === "OWNER" || user.role === "BROKER";
  } catch (error) {
    if (error instanceof AuthenticationRequiredError) {
      redirect("/sign-in");
    }
    throw error;
  }

  return (
    <main>
      <h1>Listing submitted for review</h1>
      <p>Your listing is awaiting review and is not publicly published yet.</p>
      {canManageListings ? (
        <p>
          <Link className="text-link" href="/my/listings">
            View my listings
          </Link>
        </p>
      ) : null}
    </main>
  );
}
