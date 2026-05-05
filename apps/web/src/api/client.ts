// Web UI and the API live in the same Next.js app on Vercel. Default to a
// same-origin fetch so deployments work without an explicit env var; only
// override NEXT_PUBLIC_API_URL when the caller is cross-origin (e.g. running
// the mobile dev build against a deployed API).
const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "";

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function api<T>(
  path: string,
  init: RequestInit = {},
  accessToken?: string
): Promise<T> {
  const response = await fetch(`${apiUrl}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
  });
  if (!response.ok) {
    throw new ApiError(response.status, await response.text());
  }
  return (await response.json()) as T;
}
