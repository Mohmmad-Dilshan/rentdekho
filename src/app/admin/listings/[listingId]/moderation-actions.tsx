"use client";

import { useActionState } from "react";
import {
  approveListing,
  initialModerationActionState,
  rejectListing,
} from "./actions";

export function ModerationActions({ listingId }: { listingId: string }) {
  const [approveState, approveAction, isApproving] = useActionState(
    approveListing,
    initialModerationActionState,
  );
  const [rejectState, rejectAction, isRejecting] = useActionState(
    rejectListing,
    initialModerationActionState,
  );

  return (
    <section aria-labelledby="moderation-actions-heading">
      <h2 id="moderation-actions-heading">Moderation decision</h2>
      <form action={approveAction}>
        <input name="listingId" type="hidden" value={listingId} />
        <button type="submit" disabled={isApproving || isRejecting}>
          {isApproving ? "Publishing…" : "Approve and publish"}
        </button>
        {approveState.error ? <p role="alert">{approveState.error}</p> : null}
        {approveState.message ? (
          <p role="status">{approveState.message}</p>
        ) : null}
      </form>
      <form action={rejectAction}>
        <input name="listingId" type="hidden" value={listingId} />
        <button type="submit" disabled={isApproving || isRejecting}>
          {isRejecting ? "Rejecting…" : "Reject listing"}
        </button>
        {rejectState.error ? <p role="alert">{rejectState.error}</p> : null}
        {rejectState.message ? (
          <p role="status">{rejectState.message}</p>
        ) : null}
      </form>
    </section>
  );
}
