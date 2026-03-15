<div align="center">

# 🧠 MemChat

**Enterprise-Grade Multi-Tenant AI Memory System**

A secure, high-performance backend for building AI applications with persistent memory, designed for large-scale enterprise deployments with strict multi-tenant isolation.

[![TypeScript](https://img.shields.io/badge/TypeScript-5.6-blue?logo=typescript)](https://www.typescriptlang.org/)
[![Express](https://img.shields.io/badge/Express-4.21-green?logo=express)](https://expressjs.com/)
[![Milvus](https://img.shields.io/badge/Milvus-2.4-orange?logo=milvus)](https://milvus.io/)
[![License](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

[Quick Start](#-quick-start) · [Features](#-features) · [Architecture](#-architecture) · [API Docs](#-api-endpoints) · [Configuration](#-configuration)

</div>

---

## 🎯 Why MemChat?

Building AI apps with memory is hard. Building **enterprise-scale, multi-tenant** AI apps with memory is harder.

**Common challenges:**

- ❌ Data isolation between users is complex and error-prone
- ❌ Vector databases grow indefinitely, storing irrelevant conversations
- ❌ RAG systems need memory, but how do you manage it at scale?
- ❌ Single LLM round-trip for memory evaluation is too slow
- ❌ Pure vector search misses keyword-critical memories

**MemChat solves all of these out of the box:**

- ✅ **Dual-layer isolation** — JWT + database partition key enforcement
- ✅ **Cognitive memory model** — semantic / episodic / procedural / todo classification
- ✅ **Single-call memory pipeline** — 2 LLM calls → 1, ~50% latency reduction
- ✅ **Hybrid retrieval** — vector + keyword + time decay + importance scoring
- ✅ **Session-aware working memory** — natural multi-turn conversation context
- ✅ **Embedding LRU cache** — eliminate redundant inference for repeated text
- ✅ **HNSW vector index** — million-scale performance, enterprise-ready

---

## 🎬 Demo

<div align="center">

![MemChat Demo](./image/README/demo.gif)

**Your AI assistant that truly remembers — across sessions, workspaces, and time**

</div>

### ✨ Persistent Memory Across Sessions

```
📝 Day 1, Workspace "work":
User: "I prefer TypeScript for backend, and I work at TikTok's infra team"
AI:   "Got it! I'll remember your stack preference and team context..."
      → Stores: semantic memory (preference), episodic memory (team info)

📝 Day 3, new session (memory auto-retrieved):
User: "What language should I use for my new API?"
AI:   "Based on your TypeScript preference and TikTok infra context, consider..."
      ↑ Long-term memory retrieved via hybrid search!

📝 Same session, continuing conversation:
User: "Also, remind me about the architecture discussion we just had"
AI:   "Sure! Earlier you mentioned wanting to use microservices for..."
      ↑ Working memory — no retrieval needed, context is in-session!
```

---

## 🚀 Features

### 🧠 Cognitive Memory Architecture

MemChat models memory after human cognitive science, with four distinct memory types:

```
┌─────────────────────────────────────────────────────────────┐
│                   Memory Taxonomy                            │
├──────────────┬──────────────────────────────────────────────┤
│ semantic     │ Stable facts: preferences, skills, background │
│ episodic     │ Events: meetings, decisions, experiences      │
│ procedural   │ Patterns: habits, workflows, behaviors        │
│ todo         │ Tasks: reminders, deadlines, action items     │
└──────────────┴──────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                Memory Layer Architecture                     │
├──────────────────────────┬──────────────────────────────────┤
│ Working Memory (session) │ Last N turns, in-context         │
│ Long-term Memory (Milvus)│ Persistent, RAG-retrieved        │
└──────────────────────────┴──────────────────────────────────┘
```

### ⚡ Single-Call Memory Pipeline

**Before (2 LLM calls, serial):**
```
embed(summary) → search → LLM: importance check → LLM: update decision
                                    ↑ latency ~2s         ↑ latency ~1s
```

**After (1 LLM call):**
```
embed(userMessage) → search → LLM: extract facts + decide (all-in-one)
  ↑ cache hit likely        ↑ latency ~1s + batch multi-fact support
```

Key benefits:
- **~50% reduction** in memory pipeline latency
- **Batch fact extraction** — extracts multiple facts per conversation
- **Embedding cache hit** — RAG phase already embedded the user message

### 🔍 Hybrid Retrieval with Reranking

Pure vector search is not enough. MemChat uses a multi-signal scoring pipeline:

```
Retrieve topK × 3 candidates from Milvus
              ↓
   Multi-signal scoring:
   ┌─────────────────────────────────────────────────────┐
   │ vector_sim    × 0.50  (semantic similarity)         │
   │ keyword_score × 0.20  (BM25-inspired term overlap)  │
   │ time_decay    × 0.15  (Ebbinghaus forgetting curve) │
   │ importance    × 0.15  (LLM-assigned importance)     │
   └─────────────────────────────────────────────────────┘
              ↓
   Re-rank → return topK
```

**Time decay formula (Ebbinghaus-inspired):**
```
score = exp(-ln(2) × age_days / half_life_days)
```
Memories fade naturally over time, just like human memory.

### 💬 Session-Aware Working Memory

```
POST /api/chat { sessionId: "optional-client-id", message: "..." }

LLM receives:
  [system: persona + long-term memories]
  [user: "turn 1"]          ← working memory
  [assistant: "turn 1"]     ← working memory
  [user: "turn 2"]          ← working memory
  [assistant: "turn 2"]     ← working memory
  [user: "current message"] ← current turn
```

- **Natural multi-turn** — no need to repeat context in every message
- **Session isolation** — each sessionId maintains independent context
- **Auto-expiry** — sessions expire after configurable TTL (default 2 hours)

### 🚀 Embedding LRU Cache

```
chat() → embed(userMessage) → cache MISS → model inference → cache SET
                                    ↓
processAndStoreMemory() → embed(userMessage) → cache HIT → instant return
                                    ↓
                           Zero redundant inference!
```

- LRU eviction with configurable max size (default 2000 entries)
- Cache stats available via service for monitoring

### 🗄️ HNSW Vector Index

```
Index: IVF_FLAT → HNSW
       ↑ good for <100K    ↑ designed for millions
       ↑ exact search       ↑ approximate, high recall
       ↑ nprobe tuning      ↑ ef tuning (simpler)

Params: M=16, efConstruction=200 (build quality)
Search: ef=max(64, topK×4)       (query quality)
```

### 🔐 Enterprise-Grade Multi-Tenancy

```
┌──────────────────────────────────────────────────────┐
│  Layer 1: JWT Authentication Middleware               │
│  - Extracts user_id from signed token                 │
│  - Rejects all unauthenticated requests               │
└──────────────────────────────────────────────────────┘
                        │
                        ▼
┌──────────────────────────────────────────────────────┐
│  Layer 2: Milvus Partition Key Enforcement            │
│  - user_id is Partition Key (physical data isolation) │
│  - All queries force-filtered by user_id              │
│  - Impossible to access another user's data           │
└──────────────────────────────────────────────────────┘
```

**Security guarantee:** Even if auth middleware is bypassed, data layer prevents cross-tenant access.

### 🗜️ Hierarchical Memory Compression

```
Level 0: Raw conversation chunks
    ↓ (greedy vector clustering + LLM summarization)
Level 1: Topic summaries
    ↓ (same process)
Level 2: High-level abstractions

Trigger: when memories reach 50% of maxMemoriesPerUser
Cleanup: when memories reach 90% of maxMemoriesPerUser
         → delete expired → compress → retention scoring → LLM evaluation
```

---

## 🏗️ Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│                          Client / Frontend                            │
└──────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌──────────────────────────────────────────────────────────────────────┐
│                       Express.js Server                               │
│  ┌─────────────────┐  ┌──────────────────┐  ┌────────────────────┐  │
│  │ Auth Middleware │  │   Controllers    │  │      Routes        │  │
│  │  (JWT Verify)   │  │  (Business Logic)│  │   (Endpoints)      │  │
│  └─────────────────┘  └──────────────────┘  └────────────────────┘  │
└──────────────────────────────────────────────────────────────────────┘
                                  │
         ┌────────────────────────┼──────────────────────┐
         ▼                        ▼                       ▼
┌─────────────────┐   ┌───────────────────────┐  ┌──────────────────┐
│   LLM Service   │   │    Memory Service     │  │Embedding Service │
│ (OpenAI compat) │   │ ┌───────────────────┐ │  │  (Local Model)   │
│                 │   │ │  Pipeline (1-call) │ │  │  + LRU Cache     │
│ chat() with     │   │ │  Hybrid Retrieval  │ │  └──────────────────┘
│ working memory  │   │ │  Time Decay Score  │ │
└─────────────────┘   │ └───────────────────┘ │
                       └───────────────────────┘
         ┌────────────────────────┼──────────────────────┐
         ▼                        ▼                       ▼
┌─────────────────┐   ┌───────────────────────┐  ┌──────────────────┐
│ Working Memory  │   │    Milvus (HNSW)      │  │  Compression     │
│   Service       │   │  user_memories        │  │  Service         │
│ (session store) │   │  (Partition by user)  │  │ (cluster+LLM)    │
└─────────────────┘   └───────────────────────┘  └──────────────────┘
```

---

## 📦 Quick Start

### Prerequisites

- Node.js 18+
- Docker & Docker Compose
- OpenAI API key (or compatible endpoint)

### Installation

```bash
# Clone the repository
git clone https://github.com/your-username/memchat.git
cd memchat

# Start Milvus (vector database)
docker-compose up -d

# Install dependencies
npm install

# Configure environment
cp .env.example .env
# Edit .env with your API keys

# Start development server
npm run dev
```

Visit `http://localhost:3000` for the interactive testing UI.

---

## ⚙️ Configuration

### Core Environment Variables

```env
# Server
PORT=3000
NODE_ENV=development

# JWT
JWT_SECRET=your-super-secret-key

# Milvus
MILVUS_ADDRESS=localhost:19530

# LLM (OpenAI compatible)
LLM_API_KEY=your-api-key
LLM_BASE_URL=https://api.openai.com/v1
LLM_MODEL=gpt-4
```

### Working Memory Tuning

```env
# Max messages kept per session (user+assistant each count as 1)
WORKING_MEMORY_MAX_MESSAGES=20

# Session expiry in minutes (default: 2 hours)
WORKING_MEMORY_TTL_MINUTES=120

# Disable if not needed
WORKING_MEMORY_ENABLED=true
```

### Embedding Cache Tuning

```env
# Max cached embeddings (LRU eviction)
EMBEDDING_CACHE_MAX_SIZE=2000

# Disable for debugging
EMBEDDING_CACHE_ENABLED=true
```

### Hybrid Retrieval Weights

```env
# Weights must sum to ~1.0
RETRIEVAL_VECTOR_WEIGHT=0.50      # Semantic similarity
RETRIEVAL_KEYWORD_WEIGHT=0.20     # Keyword overlap (BM25-inspired)
RETRIEVAL_TIME_DECAY_WEIGHT=0.15  # Recency (Ebbinghaus curve)
RETRIEVAL_IMPORTANCE_WEIGHT=0.15  # LLM-assigned importance

# Half-life for time decay (days) — memories at this age score ~0.5
RETRIEVAL_HALF_LIFE_DAYS=90

# Candidate pool multiplier (topK × this = candidates fetched for reranking)
RETRIEVAL_CANDIDATE_MULTIPLIER=3
```

### Memory Management

```env
MAX_MEMORIES_PER_USER=1000
MEMORY_CLEANUP_THRESHOLD=0.9    # Trigger cleanup at 90% capacity
MEMORY_CLEANUP_TARGET=0.7       # Reduce to 70% after cleanup
MEMORY_SIMILARITY_TOP_K=8       # Candidates for write dedup
MEMORY_SIMILARITY_THRESHOLD=0.7 # L2 threshold for similarity
```

---

## 📖 API Endpoints

### Authentication

<details>
<summary><code>POST /api/auth/register</code> - Register User</summary>

```bash
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"username": "alice"}'
```

**Response:**
```json
{
  "userId": "alice",
  "username": "alice",
  "token": "eyJhbGciOiJIUzI1NiIs..."
}
```

</details>

<details>
<summary><code>POST /api/auth/login</code> - Login</summary>

```bash
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username": "alice"}'
```

</details>

### Chat

<details>
<summary><code>POST /api/chat</code> - Send Message</summary>

```bash
curl -X POST http://localhost:3000/api/chat \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "workspaceId": "work-project",
    "message": "I prefer TypeScript for backend development",
    "sessionId": "optional-session-uuid"
  }'
```

**Response:**
```json
{
  "response": "I'll remember that you prefer TypeScript...",
  "memoriesUsed": 2,
  "memoriesStored": 1,
  "sessionId": "alice:work-project"
}
```

**Upgraded Flow:**
1. Resolves or creates session (working memory)
2. Retrieves long-term memories via **hybrid search** (vector + keyword + time decay)
3. Calls LLM with **session history + long-term memories + current message**
4. Updates working memory (sync)
5. Async **pipeline**: single LLM call extracts facts + decides create/update/merge/skip

</details>

### Memory Management

<details>
<summary><code>GET /api/memories?workspaceId=xxx</code> - List Memories</summary>

```bash
curl "http://localhost:3000/api/memories?workspaceId=work-project" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

**Response:**
```json
{
  "count": 3,
  "memories": [
    {
      "id": "memory-uuid",
      "content": "User prefers TypeScript for backend",
      "importanceScore": 8
    }
  ]
}
```

</details>

<details>
<summary><code>PUT /api/memories/:id</code> - Update Memory</summary>

```bash
curl -X PUT http://localhost:3000/api/memories/memory-uuid \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"content": "Updated content"}'
```

</details>

<details>
<summary><code>DELETE /api/memories/:id</code> - Delete Memory</summary>

```bash
curl -X DELETE http://localhost:3000/api/memories/memory-uuid \
  -H "Authorization: Bearer YOUR_TOKEN"
```

</details>

---

## 🛠️ Tech Stack

| Component | Technology | Notes |
| --------- | ---------- | ----- |
| **Runtime** | Node.js + TypeScript | Type-safe throughout |
| **Framework** | Express.js | REST API |
| **Vector DB** | Milvus 2.4 | HNSW index, Partition Key isolation |
| **Embeddings** | @xenova/transformers (local) | MiniLM-L12-v2, 384-dim, with LRU cache |
| **LLM** | OpenAI API (or compatible) | Single-call pipeline |
| **Auth** | JWT | Stateless, multi-tenant |
| **Container** | Docker Compose | Milvus + etcd + MinIO |

---

## 📁 Project Structure

```
src/
├── config/
│   └── index.ts                    # All config with env var overrides
├── middlewares/
│   └── auth.middleware.ts          # JWT verification
├── services/
│   ├── memory.service.ts           # Memory orchestration (pipeline + hybrid retrieval)
│   ├── working-memory.service.ts   # Session-level short-term memory
│   ├── milvus.service.ts           # Vector DB (HNSW, Partition Key isolation)
│   ├── embedding.service.ts        # Embeddings + LRU cache
│   ├── llm.service.ts              # LLM (chat with session history, pipeline)
│   ├── chunking.service.ts         # Text chunking
│   ├── compression.service.ts      # Cluster-based memory compression
│   ├── memory-cleanup.service.ts   # Cleanup orchestration
│   ├── cleanup.service.ts          # Periodic expired memory cleanup
│   └── persona.service.ts          # AI persona management
├── controllers/
│   ├── chat.controller.ts          # Chat endpoint with working memory
│   ├── memory.controller.ts        # Memory CRUD
│   ├── auth.controller.ts
│   └── persona.controller.ts
├── routes/
├── types/
│   └── index.ts                    # Full type definitions incl. MemoryCategory
└── utils/
```

---

## 🔒 Security Best Practices

1. **Never trust client input** — all `user_id` from JWT, never from request body
2. **Defense in depth** — auth middleware + Milvus partition key (two independent layers)
3. **No plaintext secrets** — environment variables only
4. **Input validation** — TypeScript type checking on all endpoints
5. **Tenant isolation** — even if one tenant guesses another's `workspaceId`, user_id partition key blocks all cross-tenant queries

---

## 📊 Performance Characteristics

| Scenario | Before | After |
|----------|--------|-------|
| Memory pipeline LLM calls | 2 (serial) | 1 |
| Embedding for same message | 2× inference | 1× (cache hit) |
| Search candidates for retrieval | topK exact | topK × 3 + rerank |
| Index type | IVF_FLAT | HNSW (million-scale) |
| Multi-turn context | Not supported | Working memory (last N turns) |

---

## 🗺️ Roadmap

- [ ] Streaming responses (SSE)
- [ ] Knowledge graph layer (entity + relation extraction)
- [ ] Pluggable embedding model (support OpenAI, Cohere, etc.)
- [ ] Redis-backed working memory (for multi-instance deployments)
- [ ] Multi-modal memory (images, files)
- [ ] Admin dashboard with memory analytics
- [ ] Rate limiting per tenant
- [ ] Prometheus metrics endpoint

---

## 🤝 Contributing

Contributions are welcome! Please read our [Contributing Guide](CONTRIBUTING.md) for details.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

---

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

## 🙏 Acknowledgments

- [Milvus](https://milvus.io/) — High-performance vector database with HNSW support
- [Transformers.js](https://huggingface.co/docs/transformers.js) — Local multilingual embeddings
- [OpenAI](https://openai.com/) — LLM capabilities

---

<div align="center">

**⭐ If this project helped you, please give it a star! ⭐**

[Report Bug](https://github.com/your-username/memchat/issues) · [Request Feature](https://github.com/your-username/memchat/issues)

</div>
