/**
 * Home Page — app/page.js
 *
 * In Next.js (App Router), each folder under `app/` can have a `page.js` file
 * that defines the content for that URL route:
 *   app/page.js         →  "/"  (the home page)
 *   app/about/page.js   →  "/about"
 *
 * By default, page.js is a SERVER COMPONENT — it runs on the server, not in
 * the browser. This is great for fetching data, but it can't use React hooks
 * like useState or useEffect, and it can't handle browser events like onClick.
 *
 * Since our email triage app is highly interactive (sorting, filtering,
 * dropdowns, etc.), the actual UI lives in a CLIENT COMPONENT (EmailTriage.js).
 * This page just renders that component.
 */

// Import the main interactive component.
// The EmailTriage component is marked as "use client" so React runs it in the browser.
import EmailTriage from "@/components/EmailTriage";

export default function HomePage() {
  // This server component simply renders the client component.
  // In a more complex app, you might fetch data here on the server and pass it
  // as props — but since our data changes based on user actions, we fetch it
  // client-side inside the component instead.
  return <EmailTriage />;
}
