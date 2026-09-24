import "server-only";
import { headers } from "next/headers";
import { prisma } from "../db/prisma";
import { auth } from "./auth";
import {
  assertOwnership,
  assertRole,
  AuthenticationRequiredError,
  AuthorizationError,
  type UserRole,
} from "./authorization-rules";

export {
  assertOwnership,
  assertRole,
  AuthenticationRequiredError,
  AuthorizationError,
} from "./authorization-rules";

export async function getCurrentUser() {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  return session?.user ?? null;
}

export async function requireUser() {
  const user = await getCurrentUser();

  if (!user) {
    throw new AuthenticationRequiredError();
  }

  return user;
}

export async function requireRole(allowedRoles: readonly UserRole[]) {
  const user = await requireUser();
  assertRole(user.role as UserRole, allowedRoles);
  return user;
}

export async function requireListingOwnership(listingId: string) {
  const user = await requireUser();
  const listing = await prisma.listing.findUnique({
    where: { id: listingId },
    select: { ownerId: true },
  });

  if (!listing) {
    throw new AuthorizationError("The requested listing does not exist.");
  }

  assertOwnership(listing.ownerId, user.id);
  return { user, listing };
}
