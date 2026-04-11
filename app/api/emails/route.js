/**
 * API Route: GET /api/emails
 *
 * In Next.js (App Router), API endpoints are created by placing a `route.js`
 * file inside the `app/api/` directory. The folder path becomes the URL:
 *   app/api/emails/route.js  →  GET /api/emails
 *
 * Each HTTP method you want to handle (GET, POST, etc.) is exported as a
 * named function. Next.js calls the right one based on the request method.
 *
 * This route reads the Gmail and Outlook JSON files from the external
 * workspace folder and returns them together as one JSON response.
 */

import { readFile, stat } from "fs/promises";
import path from "path";

// The external folder where Skill 1 writes the email JSON files.
// This is the same path that was in the old server.js.
const EMAIL_SOURCE =
  "C:\\Users\\gabri\\Documents\\Claude\\Workspace\\Personal Assistance\\email-source";

/**
 * GET handler — called when the browser fetches /api/emails
 *
 * Next.js API routes use the Web standard `Response` object (not Express-style
 * res.json()). You return a Response and Next.js sends it to the client.
 */
export async function GET() {
  const result = {};

  for (const src of ["gmail", "outlook"]) {
    const filePath = path.join(EMAIL_SOURCE, `${src}-emails.json`);
    try {
      const raw = await readFile(filePath, "utf8");
      result[src] = JSON.parse(raw);

      // Get the file's last-modified timestamp so the UI can warn if data is stale
      const fileInfo = await stat(filePath);
      result[`${src}Modified`] = fileInfo.mtime.toISOString();
    } catch {
      // If the file doesn't exist yet (Skill 1 hasn't run), return an empty array
      result[src] = [];
      result[`${src}Modified`] = null;
    }
  }

  // Return JSON using the built-in Response constructor.
  // NextResponse.json() is a shortcut, but plain Response works fine too.
  return Response.json(result);
}
