import { redirect } from "next/navigation";
import {
  AuthenticationRequiredError,
  AuthorizationError,
  requireRole,
} from "../../../server/auth/authorization";
import { prisma } from "../../../server/db/prisma";
import { ListingForm } from "./listing-form";

export default async function NewListingPage() {
  try {
    await requireRole(["OWNER", "BROKER"]);
  } catch (error) {
    if (error instanceof AuthenticationRequiredError) {
      redirect("/sign-in");
    }
    if (error instanceof AuthorizationError) {
      return (
        <main>
          <h1>Listing submission is unavailable</h1>
          <p>Only owner and broker accounts can submit rental listings.</p>
        </main>
      );
    }
    throw error;
  }

  const [cities, localities, propertyTypes, amenities] = await Promise.all([
    prisma.city.findMany({
      select: { id: true, name: true, state: true },
      orderBy: [{ name: "asc" }, { state: "asc" }],
    }),
    prisma.locality.findMany({
      select: { id: true, cityId: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.propertyType.findMany({
      select: { id: true, label: true },
      orderBy: { label: "asc" },
    }),
    prisma.amenity.findMany({
      select: { id: true, label: true },
      orderBy: { label: "asc" },
    }),
  ]);

  return (
    <main>
      <h1>Submit a rental listing</h1>
      <p>Submitted listings are reviewed before they can be published.</p>
      <ListingForm
        cities={cities}
        localities={localities}
        propertyTypes={propertyTypes}
        amenities={amenities}
      />
    </main>
  );
}
