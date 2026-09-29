"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import {
  markListingRented,
  withdrawPendingListing,
  withdrawPublishedListing,
} from "./actions";

const initialOwnerActionState = { error: null };

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      className="button button--secondary"
      type="submit"
      disabled={pending}
    >
      {pending ? "Updating…" : label}
    </button>
  );
}

function RentedAction({ listingId }: { listingId: string }) {
  const [state, formAction] = useActionState(
    markListingRented,
    initialOwnerActionState,
  );
  return (
    <form action={formAction} className="owner-action-form">
      <input type="hidden" name="listingId" value={listingId} />
      <SubmitButton label="Mark rented" />
      {state.error ? <p role="alert">{state.error}</p> : null}
    </form>
  );
}

function WithdrawPendingAction({ listingId }: { listingId: string }) {
  const [state, formAction] = useActionState(
    withdrawPendingListing,
    initialOwnerActionState,
  );
  return (
    <form action={formAction} className="owner-action-form">
      <input type="hidden" name="listingId" value={listingId} />
      <SubmitButton label="Withdraw listing" />
      {state.error ? <p role="alert">{state.error}</p> : null}
    </form>
  );
}

function WithdrawPublishedAction({ listingId }: { listingId: string }) {
  const [state, formAction] = useActionState(
    withdrawPublishedListing,
    initialOwnerActionState,
  );
  return (
    <form action={formAction} className="owner-action-form">
      <input type="hidden" name="listingId" value={listingId} />
      <SubmitButton label="Withdraw listing" />
      {state.error ? <p role="alert">{state.error}</p> : null}
    </form>
  );
}

export function OwnerListingActions({
  listingId,
  status,
}: {
  listingId: string;
  status: "PUBLISHED" | "PENDING_REVIEW";
}) {
  return (
    <section className="contact-note" aria-labelledby="manage-listing-heading">
      <h2 id="manage-listing-heading">Manage availability</h2>
      <p>
        These changes are final. Mark rented when the property is taken;
        withdraw to remove it from review or public browsing.
      </p>
      <div className="owner-actions">
        {status === "PUBLISHED" ? <RentedAction listingId={listingId} /> : null}
        {status === "PUBLISHED" ? (
          <WithdrawPublishedAction listingId={listingId} />
        ) : (
          <WithdrawPendingAction listingId={listingId} />
        )}
      </div>
    </section>
  );
}
