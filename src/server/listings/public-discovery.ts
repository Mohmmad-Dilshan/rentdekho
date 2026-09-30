export const publicListingPageSize = 12;
export type PublicCursor = { createdAt: Date; id: string };

export function decodePublicCursor(value: unknown): PublicCursor | undefined {
  if (
    typeof value !== "string" ||
    value.length > 256 ||
    !/^[A-Za-z0-9_-]+$/.test(value)
  )
    return undefined;
  try {
    const [date, id, ...extra] = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8"),
    );
    if (extra.length || typeof date !== "string" || !parseIdentifier(id))
      return undefined;
    const createdAt = new Date(date);
    if (
      !Number.isFinite(createdAt.getTime()) ||
      createdAt.toISOString() !== date
    )
      return undefined;
    return { createdAt, id };
  } catch {
    return undefined;
  }
}

export function encodePublicCursor(listing: { createdAt: Date; id: string }) {
  return Buffer.from(
    JSON.stringify([listing.createdAt.toISOString(), listing.id]),
  ).toString("base64url");
}

type SearchParamValue = string | string[] | undefined;

export type PublicListingQuery = {
  localityId?: string;
  propertyTypeId?: string;
  cursor?: string;
};

export type PublicListingAmenity = {
  label: string;
};

export type PublicListingView = {
  id: string;
  title: string;
  description: string | null;
  rentAmountPaise: bigint;
  securityDepositAmountPaise: bigint | null;
  availableFrom: Date | null;
  furnishingStatus: string;
  tenantPreference: string;
  createdAt: Date;
  updatedAt: Date;
  locality: { name: string; city: { name: string } };
  propertyType: { label: string };
  amenities: PublicListingAmenity[];
};

export type PublicListingDetailView = PublicListingView & {
  contactPhone: string | null;
};

export type PublicDiscoveryFilters = {
  localities: { id: string; name: string; cityName: string }[];
  propertyTypes: { id: string; label: string }[];
};

export type PublicListingRepository = {
  findPublishedListings(input: {
    localityId?: string;
    propertyTypeId?: string;
    cursor?: PublicCursor;
    take: number;
  }): Promise<PublicListingView[]>;
  findPublishedListingById(id: string): Promise<PublicListingDetailView | null>;
  findPublicDiscoveryFilters(): Promise<PublicDiscoveryFilters>;
  findPublishedSitemapEntries(): Promise<{ id: string; updatedAt: Date }[]>;
};

function firstValue(value: SearchParamValue) {
  return typeof value === "string" ? value : undefined;
}

function parseIdentifier(value: SearchParamValue) {
  const normalized = firstValue(value)?.trim();

  return normalized && /^[a-z0-9]{10,36}$/.test(normalized)
    ? normalized
    : undefined;
}

export function parsePublicListingQuery(
  searchParams: Record<string, SearchParamValue>,
): PublicListingQuery {
  return {
    localityId: parseIdentifier(searchParams.locality),
    propertyTypeId: parseIdentifier(searchParams.propertyType),
    cursor: decodePublicCursor(firstValue(searchParams.cursor)?.trim())
      ? firstValue(searchParams.cursor)?.trim()
      : undefined,
  };
}

export async function discoverPublicListings(
  query: PublicListingQuery,
  repository: PublicListingRepository,
) {
  const listings = await repository.findPublishedListings({
    localityId: parseIdentifier(query.localityId),
    propertyTypeId: parseIdentifier(query.propertyTypeId),
    cursor: decodePublicCursor(query.cursor),
    take: publicListingPageSize + 1,
  });
  const hasNextPage = listings.length > publicListingPageSize;
  const page = listings.slice(0, publicListingPageSize);

  return {
    listings: page,
    nextCursor: hasNextPage
      ? encodePublicCursor(page[page.length - 1])
      : undefined,
  };
}

export async function getPublicListingById(
  listingId: string,
  repository: PublicListingRepository,
) {
  const id = parseIdentifier(listingId);
  return id ? repository.findPublishedListingById(id) : null;
}
