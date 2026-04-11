/**
 * API Route: GET /api/actions/outlook
 *
 * Returns the saved Outlook triage actions (outlook-actions.json) on demand.
 * This file is written by the POST /api/save-actions endpoint when the user
 * clicks "Save Flag & Archive Script" in the UI.
 *
 * Returns 404 if no actions have been saved yet.
 */

import { readFile } from "fs/promises";
import path from "path";

// The folder where save-actions writes the action files
const EMAIL_TRIAGE =
  "C:\\Users\\gabri\\Documents\\Claude\\Workspace\\Personal Assistance\\email-triage";

export async function GET() {
  const filePath = path.join(EMAIL_TRIAGE, "outlook-actions.json");
  try {
    const raw = await readFile(filePath, "utf8");
    return Response.json(JSON.parse(raw));
  } catch {
    return Response.json(
      { error: "No Outlook actions found — save actions from the UI first." },
      { status: 404 }
    );
  }
}
