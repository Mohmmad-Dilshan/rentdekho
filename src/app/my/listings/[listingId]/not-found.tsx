import Link from "next/link";

export default function OwnerListingNotFound() {
  return (
    <main className="site-shell public-main">
      <div className="empty-state">
        <h1>Listing not found</h1>
        <p>This listing is not available in your account.</p>
        <Link className="button" href="/my/listings">
          Back to my listings
        </Link>
      </div>
    </main>
  );
}
