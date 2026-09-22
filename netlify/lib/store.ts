// Netlify Blobs access. Only functions come through here — never the page, never the skills.
import { getStore } from "@netlify/blobs";

/** `session` = live, what the page sees · `draft` = step 1's work in progress. */
export type DocKey = "session" | "draft";
export type WriteCondition = { onlyIfMatch: string } | { onlyIfNew: true } | Record<string, never>;

function store() {
  return getStore({ name: "triage", consistency: "strong" });
}

export async function readDoc(key: DocKey): Promise<{ doc: unknown; etag: string } | null> {
  const entry = await store().getWithMetadata(key, { type: "json" });
  if (!entry) return null;
  // Production sends the ETag with the GET. The `netlify dev` emulator does not
  // (it only has one on list / PUT), so locally it is looked up — same value its
  // If-Match check compares against.
  const etag = entry.etag ?? (await store().list({ prefix: key })).blobs.find((b) => b.key === key)?.etag;
  if (!etag) throw new Error(`Blobs returned no etag for "${key}"`);
  const doc: unknown = entry.data;
  return { doc, etag };
}

/** `modified === false` means the condition failed → HTTP 412 / MCP CONFLICT. */
export async function writeDoc(key: DocKey, doc: unknown, cond: WriteCondition = {}): Promise<{ etag: string | undefined; modified: boolean }> {
  const { etag, modified } = await store().set(key, JSON.stringify(doc, null, 2), cond);
  return { etag, modified };
}

export async function deleteDoc(key: DocKey): Promise<void> {
  await store().delete(key);
}
