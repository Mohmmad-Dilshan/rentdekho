"use client";

import { useActionState, useMemo, useState } from "react";
import { submitListing, type ListingFormState } from "./actions";
import { correctListing } from "../../my/listings/[listingId]/edit/actions";

const initialListingFormState: ListingFormState = {
  errors: {},
  formError: null,
};

type City = { id: string; name: string; state: string };
type Locality = { id: string; cityId: string; name: string };
type PropertyType = { id: string; label: string };
type Amenity = { id: string; label: string };

type ListingFormProps = {
  cities: City[];
  localities: Locality[];
  propertyTypes: PropertyType[];
  amenities: Amenity[];
  correction?: {
    listingId: string;
    reviewVersion: number;
    status: "PENDING_REVIEW" | "PUBLISHED";
    cityId: string;
    localityId: string;
    propertyTypeId: string;
    title: string;
    description: string;
    rent: string;
    securityDeposit: string;
    availableFrom: string;
    furnishingStatus: string;
    tenantPreference: string;
    amenityIds: string[];
    contactPhone: string;
  };
};

function FieldError({ message }: { message?: string }) {
  return message ? <p role="alert">{message}</p> : null;
}

export function ListingForm({
  cities,
  localities,
  propertyTypes,
  amenities,
  correction,
}: ListingFormProps) {
  const [state, formAction, isPending] = useActionState(
    correction ? correctListing : submitListing,
    initialListingFormState,
  );
  const [cityId, setCityId] = useState(correction?.cityId ?? "");
  // Corrections require a fresh explicit choice, including before hydration.
  const [contactConsent, setContactConsent] = useState(false);
  const localitiesForCity = useMemo(
    () => localities.filter((locality) => locality.cityId === cityId),
    [cityId, localities],
  );
  const hasRequiredReferenceData =
    cities.length > 0 && localities.length > 0 && propertyTypes.length > 0;

  if (!hasRequiredReferenceData) {
    return (
      <section aria-labelledby="reference-data-heading">
        <h2 id="reference-data-heading">
          Listing submission is not available yet
        </h2>
        <p>
          A city, locality, and property type must be provisioned before a
          rental listing can be submitted.
        </p>
      </section>
    );
  }

  return (
    <form action={formAction}>
      {correction ? (
        <>
          <input type="hidden" name="listingId" value={correction.listingId} />
          <input
            type="hidden"
            name="reviewVersion"
            value={correction.reviewVersion}
          />
          <input
            type="hidden"
            name="expectedStatus"
            value={correction.status}
          />
        </>
      ) : null}
      <section aria-labelledby="property-heading">
        <h2 id="property-heading">Property</h2>
        <p>
          <label htmlFor="cityId">City</label>
          <select
            id="cityId"
            name="cityId"
            value={cityId}
            onChange={(event) => setCityId(event.target.value)}
            required
          >
            <option value="">Choose a city</option>
            {cities.map((city) => (
              <option key={city.id} value={city.id}>
                {city.name}, {city.state}
              </option>
            ))}
          </select>
          <FieldError message={state.errors.cityId} />
        </p>
        <p>
          <label htmlFor="localityId">Locality</label>
          <select
            key={cityId}
            id="localityId"
            name="localityId"
            disabled={!cityId}
            defaultValue={
              cityId === correction?.cityId ? correction.localityId : ""
            }
            required
          >
            <option value="">Choose a locality</option>
            {localitiesForCity.map((locality) => (
              <option key={locality.id} value={locality.id}>
                {locality.name}
              </option>
            ))}
          </select>
          <FieldError message={state.errors.localityId} />
        </p>
        <p>
          <label htmlFor="propertyTypeId">Property type</label>
          <select
            id="propertyTypeId"
            name="propertyTypeId"
            defaultValue={correction?.propertyTypeId ?? ""}
            required
          >
            <option value="">Choose a property type</option>
            {propertyTypes.map((propertyType) => (
              <option key={propertyType.id} value={propertyType.id}>
                {propertyType.label}
              </option>
            ))}
          </select>
          <FieldError message={state.errors.propertyTypeId} />
        </p>
      </section>

      <section aria-labelledby="rental-details-heading">
        <h2 id="rental-details-heading">Rental details</h2>
        <p>
          <label htmlFor="title">Title</label>
          <input
            id="title"
            name="title"
            maxLength={160}
            defaultValue={correction?.title}
            required
          />
          <FieldError message={state.errors.title} />
        </p>
        <p>
          <label htmlFor="description">Description</label>
          <textarea
            id="description"
            name="description"
            maxLength={4000}
            rows={5}
            defaultValue={correction?.description}
          />
          <FieldError message={state.errors.description} />
        </p>
        <p>
          <label htmlFor="rent">Monthly rent (INR)</label>
          <input
            id="rent"
            name="rent"
            inputMode="decimal"
            pattern="(?=.*[1-9])\d+(\.\d{1,2})?"
            required
            defaultValue={correction?.rent}
          />
          <FieldError message={state.errors.rent} />
        </p>
        <p>
          <label htmlFor="securityDeposit">Security deposit (INR)</label>
          <input
            id="securityDeposit"
            name="securityDeposit"
            inputMode="decimal"
            pattern="\d+(\.\d{1,2})?"
            defaultValue={correction?.securityDeposit}
          />
          <FieldError message={state.errors.securityDeposit} />
        </p>
        <p>
          <label htmlFor="availableFrom">Available from</label>
          <input
            id="availableFrom"
            name="availableFrom"
            type="date"
            defaultValue={correction?.availableFrom}
          />
          <FieldError message={state.errors.availableFrom} />
        </p>
      </section>

      <section aria-labelledby="preferences-heading">
        <h2 id="preferences-heading">Preferences</h2>
        <p>
          <label htmlFor="furnishingStatus">Furnishing</label>
          <select
            id="furnishingStatus"
            name="furnishingStatus"
            defaultValue={correction?.furnishingStatus ?? "UNFURNISHED"}
          >
            <option value="UNFURNISHED">Unfurnished</option>
            <option value="SEMI_FURNISHED">Semi-furnished</option>
            <option value="FURNISHED">Furnished</option>
          </select>
          <FieldError message={state.errors.furnishingStatus} />
        </p>
        <p>
          <label htmlFor="tenantPreference">Tenant preference</label>
          <select
            id="tenantPreference"
            name="tenantPreference"
            defaultValue={correction?.tenantPreference ?? "ANY"}
          >
            <option value="ANY">Any tenant</option>
            <option value="FAMILY">Family</option>
            <option value="BACHELORS">Bachelors</option>
            <option value="FEMALE_ONLY">Female only</option>
            <option value="MALE_ONLY">Male only</option>
            <option value="STUDENTS">Students</option>
            <option value="WORKING_PROFESSIONALS">Working professionals</option>
          </select>
          <FieldError message={state.errors.tenantPreference} />
        </p>
        <fieldset>
          <legend>Amenities</legend>
          {amenities.length === 0 ? (
            <p>No amenities have been provisioned yet.</p>
          ) : (
            amenities.map((amenity) => (
              <p key={amenity.id}>
                <input
                  id={`amenity-${amenity.id}`}
                  name="amenityIds"
                  type="checkbox"
                  value={amenity.id}
                  defaultChecked={correction?.amenityIds.includes(amenity.id)}
                />
                <label htmlFor={`amenity-${amenity.id}`}>{amenity.label}</label>
              </p>
            ))
          )}
          <FieldError message={state.errors.amenityIds} />
        </fieldset>
      </section>

      <section aria-labelledby="listing-contact-heading">
        <h2 id="listing-contact-heading">Contact for this listing</h2>
        <p>
          Provide a number that tenants may call. RentDekho does not verify
          ownership of this number.
        </p>
        <p>
          <label htmlFor="contactPhone">Indian mobile number</label>
          <input
            id="contactPhone"
            name="contactPhone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            maxLength={13}
            defaultValue={correction?.contactPhone}
            onChange={() => setContactConsent(false)}
            pattern="(\+91)?[6-9][0-9]{9}"
            placeholder="10 digits or +91 followed by 10 digits"
          />
          <FieldError message={state.errors.contactPhone} />
        </p>
        <p>
          <input
            id="contactConsent"
            name="contactConsent"
            type="checkbox"
            value="on"
            checked={contactConsent}
            onChange={(event) => setContactConsent(event.target.checked)}
          />
          <label htmlFor="contactConsent">
            I consent to publicly displaying the phone number for this listing
            after ADMIN approval.
          </label>
          <FieldError message={state.errors.contactConsent} />
        </p>
        <p>
          {correction
            ? "For this correction, check consent again if you want tenants to call this number after approval. "
            : ""}
          Without consent, any number supplied remains private and tenants
          cannot call through this listing.
        </p>
      </section>

      {state.formError ? <p role="alert">{state.formError}</p> : null}
      <button type="submit" disabled={isPending}>
        {isPending
          ? "Submitting…"
          : correction
            ? "Submit correction for review"
            : "Submit listing"}
      </button>
    </form>
  );
}
