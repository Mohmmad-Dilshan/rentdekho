import type { Metadata } from "next";
import type { ReactNode } from "react";
import { PublicFooter, PublicHeader } from "../components/public-site";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "RentDekho | Rentals in Bhilwara",
    template: "%s | RentDekho",
  },
  description: "Discover published rental listings in Bhilwara, Rajasthan.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <PublicHeader />
        {children}
        <PublicFooter />
      </body>
    </html>
  );
}
