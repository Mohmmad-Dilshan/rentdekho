import Link from "next/link";
import type { ReactNode } from "react";

export function PublicHeader() {
  return (
    <header className="site-header">
      <div className="site-shell site-header__content">
        <Link className="wordmark" href="/" aria-label="RentDekho home">
          RentDekho
        </Link>
        <nav aria-label="Main navigation">
          <Link href="/rentals">Browse rentals</Link>
          <Link href="/sign-in">Sign in</Link>
        </nav>
      </div>
    </header>
  );
}

export function PublicFooter() {
  return (
    <footer className="site-footer">
      <div className="site-shell">
        <p>RentDekho is a Bhilwara-first rental marketplace.</p>
      </div>
    </footer>
  );
}

export function PageSection({ children }: { children: ReactNode }) {
  return <section className="page-section">{children}</section>;
}
