import "server-only";
import { connection } from "next/server";
// Display-only check for pages. Waiting for the request keeps the page
// dynamic, so the mode is read at runtime rather than baked in at build time.
export async function hostedMode() {
  await connection();
  return process.env.APP_MODE === "production";
}
