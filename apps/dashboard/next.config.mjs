/** @type {import('next').NextConfig} */
export default {
  typedRoutes: true,
  // The orchestrator URL the proxy reaches. Defaults to dev port.
  env: { ORCHESTRATOR_URL: process.env.ORCHESTRATOR_URL ?? "http://localhost:4000" },
  // Strict mode catches subscription leaks early.
  reactStrictMode: true,
};
