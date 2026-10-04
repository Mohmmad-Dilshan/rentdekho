import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import {
  AuthenticationRequiredError,
  AuthorizationError,
  requireRole,
} from "../../../../../server/auth/authorization";
import { prisma } from "../../../../../server/db/prisma";
import { ListingForm } from "../../../../listings/new/listing-form";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Correct listing",
  robots: { index: false, follow: false },
};

function moneyInput(value: bigint | null) {
  if (value === null) return "";
  const whole = value / BigInt(100);
  const fraction = (value % BigInt(100)).toString().padStart(2, "0");
  return fraction === "00" ? whole.toString() : `${whole}.${fraction}`;
}

export default async function EditListingPage({
  params,
}: {
  params: Promise<{ listingId: string }>;
}) {
  let actor;
  try {
    actor = await requireRole(["OWNER", "BROKER"]);
  } catch (error) {
    if (error instanceof AuthenticationRequiredError) redirect("/sign-in");
    if (error instanceof AuthorizationError) notFound();
    throw error;
  }
  const { listingId } = await params;
  const listing = await prisma.listing.findFirst({
    where: {
      id: listingId,
      ownerId: actor.id,
      status: { in: ["PENDING_REVIEW", "PUBLISHED"] },
    },
    select: {
      id: true,
      reviewVersion: true,
      status: true,
      localityId: true,
      propertyTypeId: true,
      title: true,
      description: true,
      rentAmountPaise: true,
      securityDepositAmountPaise: true,
      availableFrom: true,
      furnishingStatus: true,
      tenantPreference: true,
      contactPhone: true,
      locality: { select: { cityId: true } },
      amenities: { select: { amenityId: true } },
    },
  });
  if (
    !listing ||
    (listing.status !== "PENDING_REVIEW" && listing.status !== "PUBLISHED")
  )
    notFound();
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
    <main className="site-shell public-main">
      <p>
        <Link className="text-link" href={`/my/listings/${listing.id}`}>
          Back to listing
        </Link>
      </p>
      <h1>Correct listing</h1>
      <p>ADMIN must review each correction before it is public.</p>
      {listing.status === "PUBLISHED" ? (
        <p role="note">
          Submitting this correction immediately removes the listing and its
          contact from public view until ADMIN approves it again. You can
          withdraw the listing instead if urgent removal is needed.
        </p>
      ) : (
        <p role="note">
          This pending listing remains private. A new correction replaces the
          content awaiting ADMIN review.
        </p>
      )}
      <ListingForm
        cities={cities}
        localities={localities}
        propertyTypes={propertyTypes}
        amenities={amenities}
        correction={{
          listingId: listing.id,
          reviewVersion: listing.reviewVersion,
          status: listing.status,
          cityId: listing.locality.cityId,
          localityId: listing.localityId,
          propertyTypeId: listing.propertyTypeId,
          title: listing.title,
          description: listing.description ?? "",
          rent: moneyInput(listing.rentAmountPaise),
          securityDeposit: moneyInput(listing.securityDepositAmountPaise),
          availableFrom:
            listing.availableFrom?.toISOString().slice(0, 10) ?? "",
          furnishingStatus: listing.furnishingStatus,
          tenantPreference: listing.tenantPreference,
          amenityIds: listing.amenities.map((item) => item.amenityId),
          contactPhone: listing.contactPhone ?? "",
        }}
      />
    </main>
  );
}
