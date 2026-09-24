import Link from "next/link";
import { redirect } from "next/navigation";
import {
  AuthenticationRequiredError,
  AuthorizationError,
  requireRole,
} from "../../../server/auth/authorization";
import { prisma } from "../../../server/db/prisma";

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

export default async function AdminListingsPage() {
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

  const listings = await prisma.listing.findMany({
    where: { status: "PENDING_REVIEW" },
    orderBy: { createdAt: "asc" },
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
      owner: { select: { displayName: true, email: true } },
      locality: { select: { name: true, city: { select: { name: true } } } },
      propertyType: { select: { label: true } },
      amenities: { select: { amenity: { select: { label: true } } } },
    },
  });

  return (
    <main>
      <h1>Pending listing reviews</h1>
      <p>{listings.length} listing(s) awaiting moderation.</p>
      {listings.length === 0 ? (
        <p>No listings are awaiting review.</p>
      ) : (
        <ul>
          {listings.map((listing) => (
            <li key={listing.id}>
              <article>
                <h2>{listing.title}</h2>
                <p>Status: {listing.status}</p>
                {listing.description ? <p>{listing.description}</p> : null}
                <dl>
                  <dt>Location</dt>
                  <dd>
                    {listing.locality.name}, {listing.locality.city.name}
                  </dd>
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
                      ? listing.amenities
                          .map((item) => item.amenity.label)
                          .join(", ")
                      : "None specified"}
                  </dd>
                  <dt>Submitted by</dt>
                  <dd>
                    {listing.owner.displayName} ({listing.owner.email})
                  </dd>
                  <dt>Submitted</dt>
                  <dd>{formatDate(listing.createdAt)}</dd>
                </dl>
                <Link href={`/admin/listings/${listing.id}`}>
                  Review listing
                </Link>
              </article>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
