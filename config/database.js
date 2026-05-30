// ═══════════════════════════════════════════════════
// Supabase Client Singleton
// ═══════════════════════════════════════════════════

const { createClient } = require('@supabase/supabase-js');
const config = require('./index');
const logger = require('../utils/logger');

let supabase = null;

if (config.supabase.url && config.supabase.serviceKey) {
  supabase = createClient(config.supabase.url, config.supabase.serviceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
  logger.info('✅ Supabase client initialized');
} else {
  logger.warn(
    '⚠️  Supabase credentials not configured — database features will be unavailable. ' +
    'Set SUPABASE_URL and SUPABASE_SERVICE_KEY in your .env file.'
  );
}

module.exports = supabase;
