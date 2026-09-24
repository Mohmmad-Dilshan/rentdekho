"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "../../lib/auth-client";

export function SignOutButton() {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSignOut() {
    setIsSubmitting(true);
    await authClient.signOut();
    router.replace("/");
    router.refresh();
  }

  return (
    <button type="button" onClick={handleSignOut} disabled={isSubmitting}>
      {isSubmitting ? "Signing out…" : "Sign out"}
    </button>
  );
}
