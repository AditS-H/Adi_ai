// Diagnostic: print types of limiter and routes
try {
  const rateLimitMod = require('../middleware/rateLimit');
  console.log('healthLimiter type:', typeof rateLimitMod.healthLimiter);
  console.log('chatLimiter type:', typeof rateLimitMod.chatLimiter);
  console.log('adminLimiter type:', typeof rateLimitMod.adminLimiter);
} catch (err) {
  console.error('Failed to load rateLimit:', err && err.message);
}

try {
  const healthRoutes = require('../routes/health');
  console.log('healthRoutes type:', typeof healthRoutes);
  console.log('healthRoutes exported keys:', Object.keys(healthRoutes || {}));
} catch (err) {
  console.error('Failed to load health route:', err && err.message);
}
