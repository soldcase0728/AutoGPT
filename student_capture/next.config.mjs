/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  outputFileTracingIncludes: {
    "/api/internal/safety/process": [
      "./node_modules/ffmpeg-static/ffmpeg",
    ],
  },
  experimental: {
    // Uploads are handed to Supabase Storage directly from the phone; nothing
    // large should ever transit a route handler.
    serverActions: { bodySizeLimit: "1mb" },
  },
};

export default nextConfig;
