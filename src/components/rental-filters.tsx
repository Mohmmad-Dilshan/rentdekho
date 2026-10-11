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
      <div>
        <label htmlFor="minRent">Minimum rent (₹)</label>
        <input
          id="minRent"
          name="minRent"
          type="text"
          inputMode="decimal"
          pattern="[0-9]+([.][0-9]{1,2})?"
          maxLength={64}
          defaultValue={query.minRent ?? ""}
          aria-describedby={
            query.invalidRent
              ? "rent-budget-help rent-budget-error"
              : "rent-budget-help"
          }
          aria-invalid={query.invalidRent || undefined}
        />
      </div>
      <div>
        <label htmlFor="maxRent">Maximum rent (₹)</label>
        <input
          id="maxRent"
          name="maxRent"
          type="text"
          inputMode="decimal"
          pattern="[0-9]+([.][0-9]{1,2})?"
          maxLength={64}
          defaultValue={query.maxRent ?? ""}
          aria-describedby={
            query.invalidRent
              ? "rent-budget-help rent-budget-error"
              : "rent-budget-help"
          }
          aria-invalid={query.invalidRent || undefined}
        />
      </div>
      <button className="button button--secondary" type="submit">
        Apply filters
      </button>
      <p className="rental-filters__help" id="rent-budget-help">
        Optional budget in rupees, from ₹0.01 to ₹1,00,00,000, with up to two
        decimal places.
      </p>
      {query.invalidRent ? (
        <p
          className="rental-filters__error"
          id="rent-budget-error"
          role="alert"
        >
          Invalid rent filter. Enter positive amounts up to ₹1,00,00,000 with at
          most two decimal places, and keep the minimum at or below the maximum.
        </p>
      ) : null}
    </form>
  );
}
