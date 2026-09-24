import { redirect } from "next/navigation";
import {
  AuthenticationRequiredError,
  getCurrentUser,
} from "../../../server/auth/authorization";

export default async function ListingSubmittedPage() {
  try {
    const user = await getCurrentUser();
    if (!user) throw new AuthenticationRequiredError();
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
    </main>
  );
}
