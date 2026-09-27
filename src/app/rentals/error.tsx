"use client";

export default function RentalsError({ reset }: { reset: () => void }) {
  return (
    <main className="site-shell public-main">
      <div className="empty-state">
        <h1>Rentals are unavailable right now</h1>
        <p>Please try again in a moment.</p>
        <button className="button" type="button" onClick={reset}>
          Try again
        </button>
      </div>
    </main>
  );
}
