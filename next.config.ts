import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Native module + node-only driver: never bundle these, let Node require them.
  serverExternalPackages: ["better-sqlite3", "pg"],
};

export default nextConfig;
