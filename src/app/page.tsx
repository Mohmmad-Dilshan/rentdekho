import Link from "next/link";
import { ListingCard } from "../components/listing-card";
import { PageSection } from "../components/public-site";
import { prisma } from "../server/db/prisma";
import { discoverPublicListings } from "../server/listings/public-discovery";
import { createPrismaPublicListingRepository } from "../server/listings/prisma-public-listings-repository";

export const dynamic = "force-dynamic";

export default async function Home() {
  const { listings } = await discoverPublicListings(
    {},
    createPrismaPublicListingRepository(prisma),
  );

  return (
    <main className="site-shell public-main">
      <section className="hero">
        <p className="eyebrow">Bhilwara rentals, made easier</p>
        <h1>Find a place that fits your everyday life.</h1>
        <p>
          Browse published rental listings across Bhilwara by locality and
          property type.
        </p>
        <Link className="button" href="/rentals">
          Browse rentals
        </Link>
      </section>

      <PageSection>
        <div className="section-heading">
          <div>
            <p className="eyebrow">Latest published listings</p>
            <h2>Start your rental search here</h2>
          </div>
          <Link className="text-link" href="/rentals">
            See all rentals<span aria-hidden="true"> →</span>
          </Link>
        </div>
        {listings.length > 0 ? (
          <div className="listing-grid">
            {listings.slice(0, 3).map((listing) => (
              <ListingCard key={listing.id} listing={listing} />
            ))}
          </div>
        ) : (
          <div className="empty-state">
            <h2>Published rentals will appear here</h2>
            <p>There are no published listings to browse yet.</p>
          </div>
        )}
      </PageSection>
    </main>
  );
}
