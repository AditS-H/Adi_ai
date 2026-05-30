// ═══════════════════════════════════════════════════
// Winston Logger
// ═══════════════════════════════════════════════════

const winston = require('winston');
const path = require('path');

const isProduction = process.env.NODE_ENV === 'production';

// ---------------------------------------------------------------------------
// Custom log levels
// ---------------------------------------------------------------------------
const levels = {
  error: 0,
  warn: 1,
  info: 2,
  http: 3,
  debug: 4,
};

const colors = {
  error: 'red',
  warn: 'yellow',
  info: 'green',
  http: 'magenta',
  debug: 'cyan',
};

winston.addColors(colors);

// ---------------------------------------------------------------------------
// Formats
// ---------------------------------------------------------------------------
const jsonFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
  winston.format.errors({ stack: true }),
  winston.format.json()
);

const consoleFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.colorize({ all: true }),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
    return `[${timestamp}] ${level}: ${message}${metaStr}`;
  })
);

// ---------------------------------------------------------------------------
// Transports
// ---------------------------------------------------------------------------
const transports = [];

if (isProduction) {
  // In production (e.g. Render), only log to stdout — the platform captures it
  transports.push(
    new winston.transports.Console({
      format: jsonFormat,
    })
  );
} else {
  // Development: colorized console + file outputs
  transports.push(
    new winston.transports.Console({
      format: consoleFormat,
    }),
    new winston.transports.File({
      filename: path.join(__dirname, '..', 'logs', 'error.log'),
      level: 'error',
      format: jsonFormat,
      maxsize: 5 * 1024 * 1024, // 5 MB
      maxFiles: 3,
    }),
    new winston.transports.File({
      filename: path.join(__dirname, '..', 'logs', 'app.log'),
      format: jsonFormat,
      maxsize: 10 * 1024 * 1024, // 10 MB
      maxFiles: 5,
    })
  );
}

// ---------------------------------------------------------------------------
// Logger instance
// ---------------------------------------------------------------------------
const logger = winston.createLogger({
  level: isProduction ? 'info' : 'debug',
  levels,
  transports,
  // Don't exit on uncaught errors
  exitOnError: false,
});

module.exports = logger;
