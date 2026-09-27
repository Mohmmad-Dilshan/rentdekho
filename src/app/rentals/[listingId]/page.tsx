import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "../../../server/db/prisma";
import { getPublicListingById } from "../../../server/listings/public-discovery";
import { createPrismaPublicListingRepository } from "../../../server/listings/prisma-public-listings-repository";

export const dynamic = "force-dynamic";

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

async function findListing(listingId: string) {
  return getPublicListingById(
    listingId,
    createPrismaPublicListingRepository(prisma),
  );
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ listingId: string }>;
}): Promise<Metadata> {
  const listing = await findListing((await params).listingId);

  if (!listing) notFound();

  return {
    title: listing.title,
    description: `${listing.propertyType.label} for rent in ${listing.locality.name}, ${listing.locality.city.name}.`,
  };
}

export default async function RentalDetailPage({
  params,
}: {
  params: Promise<{ listingId: string }>;
}) {
  const listing = await findListing((await params).listingId);

  if (!listing) notFound();

  return (
    <main className="site-shell public-main">
      <p>
        <Link className="text-link" href="/rentals">
          ← Back to rentals
        </Link>
      </p>
      <article className="listing-detail">
        <p className="eyebrow">{listing.propertyType.label}</p>
        <h1>{listing.title}</h1>
        <p className="listing-detail__location">
          {listing.locality.name}, {listing.locality.city.name}
        </p>
        <p className="listing-detail__rent">
          {formatPaise(listing.rentAmountPaise)} / month
        </p>
        {listing.description ? (
          <p className="listing-detail__description">{listing.description}</p>
        ) : null}
        <dl className="listing-detail__facts">
          <div>
            <dt>Security deposit</dt>
            <dd>
              {listing.securityDepositAmountPaise !== null
                ? formatPaise(listing.securityDepositAmountPaise)
                : "Not specified"}
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
            <dt>Published listing updated</dt>
            <dd>{formatDate(listing.updatedAt)}</dd>
          </div>
        </dl>
        <section className="amenity-list" aria-labelledby="amenities-heading">
          <h2 id="amenities-heading">Amenities</h2>
          {listing.amenities.length > 0 ? (
            <ul>
              {listing.amenities.map((amenity) => (
                <li key={amenity.label}>{amenity.label}</li>
              ))}
            </ul>
          ) : (
            <p>No amenities were specified for this listing.</p>
          )}
        </section>
        <section className="contact-note" aria-labelledby="contact-heading">
          <h2 id="contact-heading">Contact</h2>
          <p>Contact options are not available in this initial release.</p>
        </section>
      </article>
    </main>
  );
}
