const productionBase = "https://tools-backend-v3um.onrender.com";
const developmentBase = "http://localhost:3000";

export function resolveApiBase(env = {}) {
  const configured = env.VITE_API_BASE_URL?.trim();
  // A developer's .env is also loaded by Vite for production builds. Loopback
  // addresses point at the phone itself once the app is installed on iOS.
  if (env.PROD && configured) {
    const hostname = new URL(configured).hostname;
    if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname === "[::1]" || /^127\./.test(hostname)) {
      return productionBase;
    }
  }
  return (configured || (env.PROD ? productionBase : developmentBase)).replace(/\/$/, "");
}
