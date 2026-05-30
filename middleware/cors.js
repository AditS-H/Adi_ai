// ═══════════════════════════════════════════════════
// CORS Middleware Configuration
// ═══════════════════════════════════════════════════

const cors = require('cors');
const config = require('../config');

// ---------------------------------------------------------------------------
// Build allowed origins list
// ---------------------------------------------------------------------------
const allowedOrigins = new Set([
  'http://localhost:3000',
  'http://localhost:5173',
  'http://localhost:3001',
]);

if (config.server.frontendUrl) {
  allowedOrigins.add(config.server.frontendUrl);
}

// ---------------------------------------------------------------------------
// CORS options
// ---------------------------------------------------------------------------
const corsOptions = {
  origin(origin, callback) {
    // Allow requests with no origin (curl, Postman, server-to-server)
    if (!origin) return callback(null, true);

    if (allowedOrigins.has(origin)) {
      return callback(null, true);
    }

    return callback(new Error(`Origin ${origin} not allowed by CORS`));
  },
  methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  maxAge: 86400, // 24 hours
  credentials: true,
};

module.exports = cors(corsOptions);
