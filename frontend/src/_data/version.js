// Build timestamp used to cache-bust CSS/JS so a redeploy always serves fresh
// assets (avoids stale app.js/api.js mismatches, especially on mobile Safari).
export default Date.now();
