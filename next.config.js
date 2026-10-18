/** @type {import('next').NextConfig} */
const isPages = process.env.GITHUB_PAGES === 'true';
const repoBase = process.env.NEXT_BASE_PATH || '/match-microscope';

const nextConfig = {
  output: 'export',
  images: { unoptimized: true },
  trailingSlash: true,
  ...(isPages ? { basePath: repoBase, assetPrefix: `${repoBase}/` } : {}),
};

module.exports = nextConfig;
