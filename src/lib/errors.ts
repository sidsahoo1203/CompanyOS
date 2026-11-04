export class AppError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export function publicError(error: unknown): {
  status: number;
  message: string;
} {
  if (error instanceof AppError)
    return { status: error.status, message: error.message };
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String(error.code)
      : "";
  if (code === "42501")
    return {
      status: 403,
      message: "You do not have permission for this action.",
    };
  if (code === "54000")
    return {
      status: 429,
      message:
        "Knowledge storage or request limit reached. Retry later or use a smaller collection.",
    };
  if (code === "55000")
    return {
      status: 409,
      message:
        "The document is already processed or processing. Wait 30 seconds before retrying interrupted work.",
    };
  if (code === "P0002")
    return {
      status: 404,
      message: "This item is unavailable, expired, or already used.",
    };
  if (code === "23505")
    return {
      status: 409,
      message: "This person is already a member or the record already exists.",
    };
  // 22021/22P05: text the database cannot store (for example NUL) is bad input.
  if (["22023", "23514", "23502", "22021", "22P05"].includes(code))
    return {
      status: 400,
      message: "Check the supplied details or workspace limits.",
    };
  return {
    status: 503,
    message:
      "CompanyOS could not complete this request. Please try again. If it continues, check the local database connection.",
  };
}
