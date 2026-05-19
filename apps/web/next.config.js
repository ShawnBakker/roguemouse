import path from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { config as loadDotenv } from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORKSPACE_ROOT = path.join(__dirname, '../..');
const WORKSPACE_ENV = path.join(WORKSPACE_ROOT, '.env.local');

// Dev convenience: hydrate process.env from the workspace-root .env.local
// before Next.js boots. Production runtime sets env vars via Coolify and
// this file is not in the standalone bundle. Existing process.env values
// take precedence (dotenv does not override).
if (existsSync(WORKSPACE_ENV)) {
  loadDotenv({ path: WORKSPACE_ENV });
}

const nextConfig = {
  output: 'standalone',
  reactStrictMode: true,
  outputFileTracingRoot: WORKSPACE_ROOT,
  transpilePackages: [
    '@roguemouse/agent',
    '@roguemouse/audit',
    '@roguemouse/inference',
    '@roguemouse/runbooks',
    '@roguemouse/schemas',
    '@roguemouse/tools',
  ],
  webpack: (config) => {
    config.resolve.extensionAlias = {
      '.js': ['.ts', '.tsx', '.js'],
      '.mjs': ['.mts', '.mjs'],
    };
    return config;
  },
};

export default nextConfig;
