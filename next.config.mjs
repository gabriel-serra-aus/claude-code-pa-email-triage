/**
 * Next.js Configuration
 *
 * This file controls how Next.js builds and serves your app.
 * For most projects you won't need to change much here.
 *
 * Docs: https://nextjs.org/docs/app/api-reference/config/next-config-js
 */

/** @type {import('next').NextConfig} */
const nextConfig = {
  // reactStrictMode: true is the default in Next.js 15+.
  // It helps catch common bugs by running components twice in dev mode.

  // Prevent Next.js from bundling these Node-only packages (they're only used
  // in API routes on the server, never shipped to the browser).
  serverExternalPackages: ['googleapis', '@azure/msal-node'],
};

export default nextConfig;
