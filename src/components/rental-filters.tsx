import type {
  PublicDiscoveryFilters,
  PublicListingQuery,
} from "../server/listings/public-discovery";

export function RentalFilters({
  filters,
  query,
}: {
  filters: PublicDiscoveryFilters;
  query: PublicListingQuery;
}) {
  return (
    <form className="rental-filters" action="/rentals">
      <div>
        <label htmlFor="locality">Locality</label>
        <select
          id="locality"
          name="locality"
          defaultValue={query.localityId ?? ""}
        >
          <option value="">All localities</option>
          {filters.localities.map((locality) => (
            <option key={locality.id} value={locality.id}>
              {locality.name}, {locality.cityName}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor="propertyType">Property type</label>
        <select
          id="propertyType"
          name="propertyType"
          defaultValue={query.propertyTypeId ?? ""}
        >
          <option value="">All property types</option>
          {filters.propertyTypes.map((propertyType) => (
            <option key={propertyType.id} value={propertyType.id}>
              {propertyType.label}
            </option>
          ))}
        </select>
      </div>
      <button className="button button--secondary" type="submit">
        Apply filters
      </button>
    </form>
  );
}
