import type { MetadataRoute } from "next";
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: ["/", "/rentals"],
      disallow: [
        "/admin",
        "/account",
        "/api",
        "/sign-in",
        "/sign-up",
        "/listings",
        "/my",
      ],
    },
  };
}
