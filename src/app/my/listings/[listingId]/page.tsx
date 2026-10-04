import Link from "next/link";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import {
  AuthenticationRequiredError,
  AuthorizationError,
  requireRole,
} from "../../../../server/auth/authorization";
import { prisma } from "../../../../server/db/prisma";
import { getOwnerListing } from "../../../../server/listings/owner-management";
import { createPrismaOwnerListingRepository } from "../../../../server/listings/prisma-owner-listings-repository";
import { OwnerListingActions } from "./owner-listing-actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Manage listing",
  robots: { index: false, follow: false },
};

function formatPaise(amount: bigint) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
  }).format(Number(amount) / 100);
}

function formatDate(date: Date | null) {
  return date
    ? new Intl.DateTimeFormat("en-IN", {
        dateStyle: "medium",
        timeZone: "UTC",
      }).format(date)
    : "Not specified";
}

export default async function MyListingDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ listingId: string }>;
  searchParams: Promise<{ updated?: string }>;
}) {
  let actor;
  try {
    actor = await requireRole(["OWNER", "BROKER"]);
  } catch (error) {
    if (error instanceof AuthenticationRequiredError) redirect("/sign-in");
    if (error instanceof AuthorizationError) {
      return (
        <main className="site-shell public-main">
          <h1>Listing management is unavailable</h1>
          <p>Only owner and broker accounts can manage listings.</p>
        </main>
      );
    }
    throw error;
  }

  const listing = await getOwnerListing(
    { id: actor.id, role: actor.role as "OWNER" | "BROKER" },
    (await params).listingId,
    createPrismaOwnerListingRepository(prisma),
  );
  if (!listing) notFound();
  const updated = (await searchParams).updated;

  return (
    <main className="site-shell public-main">
      <p>
        <Link className="text-link" href="/my/listings">
          Back to my listings
        </Link>
      </p>
      <article className="listing-detail">
        {updated === "rented" && listing.status === "RENTED" ? (
          <p role="status">Listing marked rented.</p>
        ) : null}
        {updated === "withdrawn" && listing.status === "ARCHIVED" ? (
          <p role="status">Listing withdrawn.</p>
        ) : null}
        {updated === "corrected" && listing.status === "PENDING_REVIEW" ? (
          <p role="status">
            Correction submitted for ADMIN review. This listing is not public
            while pending.
          </p>
        ) : null}
        <p className="eyebrow">{listing.status.replaceAll("_", " ")}</p>
        <h1>{listing.title}</h1>
        <p>
          {listing.propertyType.label} · {listing.locality.name},{" "}
          {listing.locality.city.name}
        </p>
        <p className="listing-detail__rent">
          {formatPaise(listing.rentAmountPaise)} / month
        </p>
        {listing.description ? (
          <p className="listing-detail__description">{listing.description}</p>
        ) : null}
        <dl className="listing-detail__facts">
          <div>
            <dt>Deposit</dt>
            <dd>
              {listing.securityDepositAmountPaise !== null
                ? formatPaise(listing.securityDepositAmountPaise)
                : "Not specified"}
            </dd>
          </div>
          <div>
            <dt>Listing contact</dt>
            <dd>{listing.contactPhone ?? "Not provided"}</dd>
          </div>
          <div>
            <dt>Public contact consent</dt>
            <dd>
              {listing.contactConsentAt
                ? "Given for this listing"
                : "Not given"}
            </dd>
          </div>
          <div>
            <dt>Furnishing</dt>
            <dd>{listing.furnishingStatus.replaceAll("_", " ")}</dd>
          </div>
          <div>
            <dt>Tenant preference</dt>
            <dd>{listing.tenantPreference.replaceAll("_", " ")}</dd>
          </div>
          <div>
            <dt>Available from</dt>
            <dd>{formatDate(listing.availableFrom)}</dd>
          </div>
          <div>
            <dt>Submitted</dt>
            <dd>{formatDate(listing.createdAt)}</dd>
          </div>
          <div>
            <dt>Last updated</dt>
            <dd>{formatDate(listing.updatedAt)}</dd>
          </div>
        </dl>
        <section aria-labelledby="owner-amenities">
          <h2 id="owner-amenities">Amenities</h2>
          {listing.amenities.length > 0 ? (
            <ul>
              {listing.amenities.map((amenity) => (
                <li key={amenity.label}>{amenity.label}</li>
              ))}
            </ul>
          ) : (
            <p>None specified.</p>
          )}
        </section>
        {listing.status === "PUBLISHED" ||
        listing.status === "PENDING_REVIEW" ? (
          <>
            <p>
              <Link className="button" href={`/my/listings/${listing.id}/edit`}>
                Correct listing
              </Link>
            </p>
            <OwnerListingActions
              listingId={listing.id}
              status={listing.status}
              reviewVersion={listing.reviewVersion}
            />
          </>
        ) : (
          <p>No actions are available for this listing.</p>
        )}
      </article>
    </main>
  );
}
