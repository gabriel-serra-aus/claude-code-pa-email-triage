/**
 * API Route: POST /api/save-actions
 *
 * This route receives the triage decisions from the browser and writes them
 * as JSON files to the external workspace folder, where Skill 2 picks them up.
 *
 * The request body looks like:
 *   { gmail: { generated, total, actions: [...] }, outlook: { ... } }
 *
 * We write two files:
 *   - gmail-actions.json
 *   - outlook-actions.json
 */

import { writeFile } from "fs/promises";
import path from "path";

// The external folder where Skill 2 reads the action files from.
const EMAIL_TRIAGE =
  "C:\\Users\\gabri\\Documents\\Claude\\Workspace\\Personal Assistance\\email-triage";

/**
 * POST handler — called when the browser sends triage decisions to save.
 *
 * In Next.js route handlers, we read the request body with `request.json()`.
 * This is the standard Web Fetch API — not Express-style req.body.
 */
export async function POST(request) {
  try {
    // Parse the JSON body from the request
    const payload = await request.json();

    // Write a separate actions file for each email source
    for (const src of ["gmail", "outlook"]) {
      const outPath = path.join(EMAIL_TRIAGE, `${src}-actions.json`);
      await writeFile(outPath, JSON.stringify(payload[src], null, 2), "utf8");
    }

    return Response.json({ ok: true });
  } catch (err) {
    // Return a 500 error if something goes wrong
    return Response.json({ ok: false, error: err.message }, { status: 500 });
  }
}
