import Link from "next/link";
import type { PublicListingView } from "../server/listings/public-discovery";

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
    : "Available date not specified";
}

export function ListingCard({ listing }: { listing: PublicListingView }) {
  return (
    <article className="listing-card">
      <p className="listing-card__type">{listing.propertyType.label}</p>
      <h2>
        <Link href={`/rentals/${listing.id}`}>{listing.title}</Link>
      </h2>
      <p className="listing-card__location">
        {listing.locality.name}, {listing.locality.city.name}
      </p>
      <p className="listing-card__rent">
        {formatPaise(listing.rentAmountPaise)} / month
      </p>
      <dl className="listing-card__facts">
        <div>
          <dt>Furnishing</dt>
          <dd>{listing.furnishingStatus.replaceAll("_", " ")}</dd>
        </div>
        <div>
          <dt>Tenant preference</dt>
          <dd>{listing.tenantPreference.replaceAll("_", " ")}</dd>
        </div>
        <div>
          <dt>Available</dt>
          <dd>{formatDate(listing.availableFrom)}</dd>
        </div>
      </dl>
      {listing.securityDepositAmountPaise !== null ? (
        <p className="listing-card__deposit">
          Deposit: {formatPaise(listing.securityDepositAmountPaise)}
        </p>
      ) : null}
      <Link className="text-link" href={`/rentals/${listing.id}`}>
        View listing<span aria-hidden="true"> →</span>
      </Link>
    </article>
  );
}
