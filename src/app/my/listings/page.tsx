import Link from "next/link";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import {
  AuthenticationRequiredError,
  AuthorizationError,
  requireRole,
} from "../../../server/auth/authorization";
import { prisma } from "../../../server/db/prisma";
import { listOwnerListings } from "../../../server/listings/owner-management";
import { createPrismaOwnerListingRepository } from "../../../server/listings/prisma-owner-listings-repository";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "My listings",
  robots: { index: false, follow: false },
};

function formatPaise(amount: bigint) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
  }).format(Number(amount) / 100);
}

export default async function MyListingsPage() {
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

  const listings = await listOwnerListings(
    { id: actor.id, role: actor.role as "OWNER" | "BROKER" },
    createPrismaOwnerListingRepository(prisma),
  );

  return (
    <main className="site-shell public-main">
      <section className="page-intro">
        <p className="eyebrow">Your rental listings</p>
        <h1>My listings</h1>
        <p>View each listing’s review and availability status.</p>
        <Link className="button" href="/listings/new">
          Submit a listing
        </Link>
      </section>
      {listings.length === 0 ? (
        <div className="empty-state page-section">
          <h2>No listings yet</h2>
          <p>Listings you submit will appear here.</p>
        </div>
      ) : (
        <section className="page-section" aria-label="Your listings">
          <p>Showing up to 25 newest listings.</p>
          <div className="listing-grid">
            {listings.map((listing) => (
              <article className="listing-card" key={listing.id}>
                <p className="listing-card__type">
                  {listing.status.replaceAll("_", " ")}
                </p>
                <h2>
                  <Link href={`/my/listings/${listing.id}`}>
                    {listing.title}
                  </Link>
                </h2>
                <p>
                  {listing.propertyType.label} · {listing.locality.name},{" "}
                  {listing.locality.city.name}
                </p>
                <p className="listing-card__rent">
                  {formatPaise(listing.rentAmountPaise)} / month
                </p>
                <p>
                  Available:{" "}
                  {listing.availableFrom
                    ? new Intl.DateTimeFormat("en-IN", {
                        dateStyle: "medium",
                        timeZone: "UTC",
                      }).format(listing.availableFrom)
                    : "Not specified"}
                </p>
                <p>
                  Submitted:{" "}
                  {new Intl.DateTimeFormat("en-IN", {
                    dateStyle: "medium",
                    timeZone: "UTC",
                  }).format(listing.createdAt)}
                </p>
                <Link className="text-link" href={`/my/listings/${listing.id}`}>
                  Manage listing
                </Link>
              </article>
            ))}
          </div>
        </section>
      )}
    </main>
  );
}
