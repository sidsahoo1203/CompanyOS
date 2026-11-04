export async function requestJson<T>(
  url: string,
  method: string,
  data: unknown,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw new Error(
      "The request could not finish. Check your connection and try again.",
    );
  }
  // A proxy or crash can return an HTML page; never show a raw parser error.
  let result: { error?: unknown; message?: unknown } | null = null;
  try {
    result = await response.json();
  } catch {
    if (response.ok)
      throw new Error("The server sent an unreadable response. Try again.");
  }
  if (!response.ok)
    throw new Error(
      typeof result?.error === "string"
        ? result.error
        : typeof result?.message === "string"
          ? result.message
          : "This request could not be completed.",
    );
  return result as T;
}
