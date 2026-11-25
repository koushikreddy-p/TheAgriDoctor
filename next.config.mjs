/** @type {import('next').NextConfig} */
const nextConfig = {
  // Type and lint errors now FAIL the build instead of being silently ignored.
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'openweathermap.org' },
      { protocol: 'https', hostname: '*.supabase.co' },
    ],
  },
};

export default nextConfig;
