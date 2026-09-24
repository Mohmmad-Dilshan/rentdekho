import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import {
  AuthenticationRequiredError,
  AuthorizationError,
  requireRole,
} from "../../../../server/auth/authorization";
import { prisma } from "../../../../server/db/prisma";
import { ModerationActions } from "./moderation-actions";

function formatPaise(amount: bigint) {
  const divisor = BigInt(100);
  const rupees = amount / divisor;
  const paise = (amount % divisor).toString().padStart(2, "0");
  return `₹${rupees.toString()}.${paise}`;
}

function formatDate(date: Date | null) {
  return date
    ? new Intl.DateTimeFormat("en-IN", {
        dateStyle: "medium",
        timeZone: "UTC",
      }).format(date)
    : "Not specified";
}

export default async function AdminListingReviewPage({
  params,
}: {
  params: Promise<{ listingId: string }>;
}) {
  try {
    await requireRole(["ADMIN"]);
  } catch (error) {
    if (error instanceof AuthenticationRequiredError) redirect("/sign-in");
    if (error instanceof AuthorizationError) {
      return (
        <main>
          <h1>Administration is unavailable</h1>
          <p>You do not have permission to review listings.</p>
        </main>
      );
    }
    throw error;
  }

  const { listingId } = await params;
  const listing = await prisma.listing.findUnique({
    where: { id: listingId },
    select: {
      id: true,
      title: true,
      description: true,
      status: true,
      rentAmountPaise: true,
      securityDepositAmountPaise: true,
      availableFrom: true,
      furnishingStatus: true,
      tenantPreference: true,
      createdAt: true,
      updatedAt: true,
      owner: { select: { displayName: true, email: true } },
      locality: { select: { name: true, city: { select: { name: true } } } },
      propertyType: { select: { label: true } },
      amenities: { select: { amenity: { select: { label: true } } } },
    },
  });

  if (!listing) notFound();

  return (
    <main>
      <p>
        <Link href="/admin/listings">Back to pending reviews</Link>
      </p>
      <h1>Review listing</h1>
      <h2>{listing.title}</h2>
      <dl>
        <dt>Status</dt>
        <dd>{listing.status}</dd>
        <dt>Description</dt>
        <dd>{listing.description ?? "Not provided"}</dd>
        <dt>City</dt>
        <dd>{listing.locality.city.name}</dd>
        <dt>Locality</dt>
        <dd>{listing.locality.name}</dd>
        <dt>Property type</dt>
        <dd>{listing.propertyType.label}</dd>
        <dt>Monthly rent</dt>
        <dd>{formatPaise(listing.rentAmountPaise)}</dd>
        <dt>Security deposit</dt>
        <dd>
          {listing.securityDepositAmountPaise
            ? formatPaise(listing.securityDepositAmountPaise)
            : "Not specified"}
        </dd>
        <dt>Available from</dt>
        <dd>{formatDate(listing.availableFrom)}</dd>
        <dt>Furnishing</dt>
        <dd>{listing.furnishingStatus}</dd>
        <dt>Tenant preference</dt>
        <dd>{listing.tenantPreference}</dd>
        <dt>Amenities</dt>
        <dd>
          {listing.amenities.length > 0
            ? listing.amenities.map((item) => item.amenity.label).join(", ")
            : "None specified"}
        </dd>
        <dt>Submitted by</dt>
        <dd>
          {listing.owner.displayName} ({listing.owner.email})
        </dd>
        <dt>Submitted</dt>
        <dd>{formatDate(listing.createdAt)}</dd>
        <dt>Last updated</dt>
        <dd>{formatDate(listing.updatedAt)}</dd>
      </dl>
      {listing.status === "PENDING_REVIEW" ? (
        <ModerationActions listingId={listing.id} />
      ) : (
        <p>This listing is no longer awaiting review.</p>
      )}
    </main>
  );
}
