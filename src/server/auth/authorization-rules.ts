export const userRoles = ["TENANT", "OWNER", "BROKER", "ADMIN"] as const;

export type UserRole = (typeof userRoles)[number];

export class AuthenticationRequiredError extends Error {
  constructor() {
    super("Authentication is required.");
    this.name = "AuthenticationRequiredError";
  }
}

export class AuthorizationError extends Error {
  constructor(message = "You are not authorized to perform this action.") {
    super(message);
    this.name = "AuthorizationError";
  }
}

export function assertRole(
  userRole: UserRole,
  allowedRoles: readonly UserRole[],
) {
  if (!allowedRoles.includes(userRole)) {
    throw new AuthorizationError();
  }
}

export function assertOwnership(ownerId: string, userId: string) {
  if (ownerId !== userId) {
    throw new AuthorizationError("You do not own this resource.");
  }
}
