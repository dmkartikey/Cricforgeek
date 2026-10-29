import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Security policy for the built site. GitHub Pages cannot send custom headers, so it goes in a <meta> tag.
// Only our own scripts run; styles and fonts may also come from Google Fonts; data is fetched only from this site.
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data:",
  `connect-src 'self' ${process.env.VITE_LIVE_API || 'https://cricforgeek-live.dmkartikey.workers.dev'}`,
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  'upgrade-insecure-requests',
].join('; ');

const securityMeta = {
  name: 'security-meta',
  apply: 'build' as const,
  transformIndexHtml: (html: string) => html.replace('<meta charset="utf-8" />', `<meta charset="utf-8" />
    <meta http-equiv="Content-Security-Policy" content="${CSP}" />
    <meta name="referrer" content="strict-origin-when-cross-origin" />`),
};

// The live site is served from the domain root with real paths (/player/abc), so assets load from "/".
// Preview builds (VITE_PREVIEW=1) use hash routing and relative paths instead.
// Each build gets an id; the app compares it with version.json to know when a newer version is out.
const BUILD_ID = process.env.GITHUB_SHA?.slice(0, 12) || String(Date.now());
const versionFile = {
  name: 'version-file',
  generateBundle(this: any) { this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ id: BUILD_ID }) }); },
};

export default defineConfig({
  define: { 'import.meta.env.VITE_BUILD_ID': JSON.stringify(BUILD_ID) },
  plugins: process.env.VITE_PREVIEW === '1' ? [react()] : [react(), securityMeta, versionFile],
  base: process.env.VITE_PREVIEW === '1' ? './' : process.env.BASE_PATH || '/',
  build: { outDir: 'dist', chunkSizeWarningLimit: 800 },
});
