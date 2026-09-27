import type { MetadataRoute } from "next";
import { prisma } from "../server/db/prisma";
import { createPrismaPublicListingRepository } from "../server/listings/prisma-public-listings-repository";
export const dynamic = "force-dynamic";
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  // No guessed canonical origin: configure the actual deployment URL first.
  const configured = process.env.BETTER_AUTH_URL;
  if (!configured) return [];
  const origin = new URL(configured);
  if (!["https:", "http:"].includes(origin.protocol)) return [];
  const entries =
    await createPrismaPublicListingRepository(
      prisma,
    ).findPublishedSitemapEntries();
  return [
    { url: new URL("/", origin).href },
    { url: new URL("/rentals", origin).href },
    ...entries.map((entry) => ({
      url: new URL(`/rentals/${entry.id}`, origin).href,
      lastModified: entry.updatedAt,
    })),
  ];
}
