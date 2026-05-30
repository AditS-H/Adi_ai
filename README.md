# AditAI — Personal AI Portfolio Assistant Backend

> An intelligent, RAG-powered conversational assistant that answers questions about Adit Sharma's skills, projects, and experience — as if Adit were speaking directly.

---

## 🏗️ Architecture Overview

```
┌─────────────┐     ┌──────────────┐     ┌────────────────┐
│   Frontend   │────▶│  Express API │────▶│  AI Providers  │
│  (React/TS)  │◀────│   Gateway    │◀────│  (Multi-LLM)   │
└─────────────┘     └──────┬───────┘     └────────────────┘
                           │
              ┌────────────┼────────────┐
              │            │            │
        ┌─────▼────┐ ┌────▼─────┐ ┌───▼────┐
        │ Supabase │ │ Upstash  │ │ GitHub │
        │ (pgvec)  │ │ (Redis)  │ │  API   │
        └──────────┘ └──────────┘ └────────┘
```

### Core Components

| Component | Purpose |
|---|---|
| **RAG Pipeline** | Retrieves relevant context from vectorized documents to ground AI responses |
| **Multi-Provider LLM** | Cascading failover across Groq → Gemini → OpenRouter → DeepSeek → Cloudflare |
| **GitHub Sync** | Automatically scrapes and indexes your public repositories |
| **Session Management** | Maintains conversational context per visitor session |
| **Admin Panel** | Protected endpoints for document management, analytics, and system health |
| **Caching Layer** | Upstash Redis + in-memory LRU for fast repeat queries |

---

## 🚀 Quick Start

### Prerequisites

- **Node.js** ≥ 20.0.0
- **Supabase** project (free tier works)
- **Upstash Redis** instance (free tier works)
- At least one AI provider API key (Groq recommended for free tier)

### 1. Clone & Install

```bash
git clone https://github.com/your-username/aditai-backend.git
cd aditai-backend
npm install
```

### 2. Configure Environment

```bash
cp .env.example .env
# Edit .env with your actual keys
```

### 3. Set Up Database

Run the SQL files in your Supabase SQL Editor:

```bash
# 1. Create tables and indexes
database/schema.sql

# 2. Create vector search function
database/functions.sql
```

### 4. Run Development Server

```bash
npm run dev
```

The server starts at `http://localhost:3000`.

---

## 📁 Project Structure

```
aditai-backend/
├── config/
│   ├── index.js          # Central config from env vars
│   ├── providers.js      # AI provider definitions
│   ├── database.js       # Supabase client singleton
│   └── cache.js          # Upstash Redis client
├── middleware/
│   ├── cors.js           # CORS configuration
│   ├── rateLimit.js      # Rate limiting (chat, admin, health)
│   ├── auth.js           # Admin authentication
│   ├── requestLogger.js  # Request ID + HTTP logging
│   └── errorHandler.js   # Global error handler
├── utils/
│   ├── logger.js         # Winston logger
│   ├── retry.js          # Exponential backoff retry
│   ├── tokenCounter.js   # Approximate token counting
│   ├── textCleaner.js    # Input sanitization & injection detection
│   └── hashUtils.js      # SHA-256 hashing utilities
├── database/
│   ├── schema.sql        # Full database schema
│   └── functions.sql     # PL/pgSQL vector search function
├── data/
│   ├── personality.md    # AI persona definition
│   ├── resume.md         # Resume content for RAG
│   └── faqs.md           # Pre-built FAQ pairs
├── .env.example          # Environment variable template
├── .gitignore
├── package.json
├── README.md
└── server.js             # Application entry point (coming soon)
```

---

## 🔑 API Endpoints

### Public

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/chat` | Send a message and get an AI response |
| `GET` | `/api/health` | System health check |

### Admin (requires `Authorization: Bearer <ADMIN_TOKEN>`)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/admin/documents` | Upload & index documents |
| `GET` | `/api/admin/documents` | List all indexed documents |
| `DELETE` | `/api/admin/documents/:id` | Remove a document |
| `POST` | `/api/admin/sync/github` | Trigger GitHub repository sync |
| `GET` | `/api/admin/analytics` | View usage analytics |
| `GET` | `/api/admin/providers` | Check AI provider health |

---

## 🤖 AI Provider Cascade

The system tries providers in priority order, automatically failing over on errors:

| Priority | Provider | Model | Style |
|----------|----------|-------|-------|
| 1 | Groq | `llama-3.1-8b-instant` | OpenAI |
| 2 | Gemini | `gemini-2.0-flash` | Gemini |
| 3 | OpenRouter | `llama-3.1-8b-instruct:free` | OpenAI |
| 4 | DeepSeek | `deepseek-chat` | OpenAI |
| 5 | Cloudflare | `@cf/meta/llama-3.1-8b-instruct` | Cloudflare |

---

## 🗄️ Database Schema

### Tables

- **documents** — Vectorized content chunks with 768-dim embeddings
- **github_repos** — Tracked repository metadata
- **chat_sessions** — Visitor conversation history
- **analytics** — Query metrics and provider usage
- **provider_health** — Real-time provider status tracking
- **admin_tokens** — Admin authentication tokens

### Vector Search

Uses `pgvector` with IVFFlat indexing for cosine similarity search across document embeddings.

---

## 🛡️ Security

- **Rate Limiting** — Per-IP limits on all endpoints
- **Input Sanitization** — Prompt injection detection and text cleaning
- **Admin Auth** — Bearer token authentication for admin routes
- **CORS** — Restricted to configured frontend origins
- **No Secrets in Code** — All credentials via environment variables

---

## 📊 Monitoring

- **Winston Logging** — Structured JSON logs with levels (error, warn, info, http, debug)
- **Request Tracing** — UUID request IDs on every request
- **Provider Health** — Automatic health scoring with cooldown periods
- **Analytics** — Query tracking, response times, cache hit rates

---

## 🚢 Deployment (Render)

1. Connect your GitHub repository to Render
2. Set environment to **Node**
3. Build command: `npm install`
4. Start command: `npm start`
5. Add all environment variables from `.env.example`

---

## 📄 License

MIT © Adit Sharma
