/**
 * Root Layout — app/layout.js
 *
 * In Next.js (App Router), every page is wrapped by a layout.
 * This file is the ROOT layout — it wraps every single page in your app.
 * It must export a default function that returns an <html> and <body> tag.
 *
 * Think of it like the "shell" of your HTML document. The {children} prop
 * is where the actual page content gets rendered.
 *
 * We also import our global CSS here so it applies to all pages.
 */

// Importing this CSS file makes it available to every page in the app.
// In Next.js, global CSS can ONLY be imported in layout files (not in regular components).
import "./globals.css";

// This metadata object sets the <title> and <meta> tags in the <head>.
// Next.js handles this automatically — you don't need to write <head> tags yourself.
export const metadata = {
  title: "Gabriel Email Triage Tool",
  description: "Review, reclassify, and action emails from Gmail and Outlook",
};

/**
 * RootLayout is called by Next.js for every page render.
 * - `children` is the page content (e.g. the component from app/page.js)
 */
export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
