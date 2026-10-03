// Step 1's run summary — one per side (`summary-<side>`), written by
// session_publish together with the session, read by `summary_get` and the
// review page's Summary panel. Replaces the local triage-summary.md.
import type { Group } from "./contract.ts";

export const SUMMARY_MAX = 200_000;

export type Summary = { side: Group; generatedAt: string; publishedAt: string; markdown: string };
