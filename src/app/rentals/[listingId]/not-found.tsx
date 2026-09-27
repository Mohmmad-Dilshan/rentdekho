import Link from "next/link";

export default function RentalNotFound() {
  return (
    <main className="site-shell public-main">
      <div className="empty-state">
        <h1>Listing not found</h1>
        <p>This rental is not available to view.</p>
        <Link className="button" href="/rentals">
          Browse rentals
        </Link>
      </div>
    </main>
  );
}
