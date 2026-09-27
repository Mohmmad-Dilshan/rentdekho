import type { Metadata } from "next";
import Link from "next/link";
import { ListingCard } from "../../components/listing-card";
import { RentalFilters } from "../../components/rental-filters";
import { PageSection } from "../../components/public-site";
import { prisma } from "../../server/db/prisma";
import {
  discoverPublicListings,
  parsePublicListingQuery,
} from "../../server/listings/public-discovery";
import { createPrismaPublicListingRepository } from "../../server/listings/prisma-public-listings-repository";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Browse rentals in Bhilwara",
  description:
    "Browse published rental listings in Bhilwara by locality and property type.",
};

export default async function RentalsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = parsePublicListingQuery(await searchParams);
  const repository = createPrismaPublicListingRepository(prisma);
  const [{ listings, nextCursor }, filters] = await Promise.all([
    discoverPublicListings(query, repository),
    repository.findPublicDiscoveryFilters(),
  ]);
  const nextParams = new URLSearchParams();

  if (query.localityId) nextParams.set("locality", query.localityId);
  if (query.propertyTypeId)
    nextParams.set("propertyType", query.propertyTypeId);
  if (nextCursor) nextParams.set("cursor", nextCursor);

  return (
    <main className="site-shell public-main">
      <section className="page-intro">
        <p className="eyebrow">Bhilwara rental discovery</p>
        <h1>Browse rentals</h1>
        <p>
          Explore currently published listings by locality and property type.
        </p>
      </section>
      <PageSection>
        <RentalFilters filters={filters} query={query} />
      </PageSection>
      <PageSection>
        <div className="section-heading">
          <h2>
            {listings.length > 0 ? "Published rentals" : "No rentals found"}
          </h2>
          {listings.length > 0 ? <p>Newest listings first.</p> : null}
        </div>
        {listings.length > 0 ? (
          <div className="listing-grid">
            {listings.map((listing) => (
              <ListingCard key={listing.id} listing={listing} />
            ))}
          </div>
        ) : (
          <div className="empty-state">
            <p>Try changing or clearing your filters.</p>
            <Link className="text-link" href="/rentals">
              Clear filters
            </Link>
          </div>
        )}
        {nextCursor ? (
          <nav className="pagination" aria-label="Rental pagination">
            <Link
              className="button button--secondary"
              href={`/rentals?${nextParams.toString()}`}
            >
              Show more rentals
            </Link>
          </nav>
        ) : null}
      </PageSection>
    </main>
  );
}
