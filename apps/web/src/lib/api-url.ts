const localApiBase = process.env.NODE_ENV === "development"
  ? (process.env.NEXT_PUBLIC_API_BASE_URL ?? "").replace(/\/+$/, "")
  : "";

/**
 * API requests use the deployed site's origin by default. A separate Worker
 * can be opted into while running `next dev` by setting
 * NEXT_PUBLIC_API_BASE_URL.
 */
export function apiUrl(path: `/${string}`, baseUrl = localApiBase): string {
  return `${baseUrl}${path}`;
}
