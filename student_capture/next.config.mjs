/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    // Uploads are handed to Supabase Storage directly from the phone; nothing
    // large should ever transit a route handler.
    serverActions: { bodySizeLimit: "1mb" },
  },
};

export default nextConfig;
