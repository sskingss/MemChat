# Multi-Assistant AI Backend

A multi-tenant AI backend service built with Express + TypeScript, featuring strict user data isolation and an AI memory system.

## Core Features

### 1. Strict Multi-Tenant Data Isolation

**Dual Isolation Mechanism:**
- **Layer 1: JWT Authentication Middleware**
  - All `/api/*` requests must carry a valid JWT token
  - Extracts `user_id` from token and attaches to `req.user.userId`

- **Layer 2: Milvus Data Layer Enforcement**
  - `user_id` is set as **Partition Key** in Collection Schema
  - All CRUD methods require `user_id` parameter
  - Queries enforce `user_id == "{userId}"` filter condition

**Security Guarantee:** Even if malicious requests bypass the authentication layer, data layer access is still prevented.

### 2. AI Memory System

- **Intelligent Memory Storage**: Uses LLM to evaluate conversation importance, avoiding database bloat
- **Vector Retrieval (RAG)**: Retrieves relevant historical memories based on semantic similarity
- **Workspace Isolation**: Same user can maintain independent memories across different workspaces

## Project Structure

```
src/
├── config/              # Configuration files
├── middlewares/         # JWT authentication middleware
├── services/            # Core service layer
│   ├── milvus.service.ts    # Milvus wrapper (core isolation logic)
│   ├── embedding.service.ts # Vectorization service
│   ├── llm.service.ts       # LLM call wrapper
│   └── memory.service.ts    # Memory management
├── controllers/         # Controllers
├── routes/              # Routes
├── types/               # TypeScript type definitions
└── utils/               # Utility functions
```

## Quick Start

### 1. Start Milvus

```bash
docker-compose up -d
```

Wait for Milvus to be ready (approximately 30-60 seconds).

### 2. Install Dependencies

```bash
npm install
```

### 3. Configure Environment Variables

Copy `.env.example` to `.env` and fill in API keys:

```bash
cp .env.example .env
```

Edit `.env`:
- `LLM_BASE_URL`: Private model service URL (e.g., `http://localhost:8000/v1`)
- `LLM_MODEL`: LLM model name (e.g., `gpt-4`)
- `LLM_EMBEDDING_MODEL`: Embedding model name (e.g., `text-embedding-ada-002`)
- `LLM_API_KEY`: Required if private model needs authentication
- `JWT_SECRET`: Change this for production

### 4. Start Server

```bash
npm run dev
```

Server will start at `http://localhost:3000`.

## API Endpoints

### 1. POST /api/auth/register - User Registration

**Request Body:**
```json
{
  "username": "testuser"
}
```

**Response:**
```json
{
  "userId": "uuid-123",
  "username": "testuser",
  "token": "jwt-token-here"
}
```

### 2. POST /api/auth/login - User Login

**Request Body:**
```json
{
  "username": "testuser"
}
```

**Response:**
```json
{
  "userId": "uuid-123",
  "username": "testuser",
  "token": "jwt-token-here"
}
```

### 3. POST /api/chat - Core Chat Endpoint

**Headers:**
```
Authorization: Bearer {token}
```

**Request Body:**
```json
{
  "workspaceId": "my-workspace-123",
  "message": "Help me write a RESTful API"
}
```

**Response:**
```json
{
  "response": "I can help you design a RESTful API...",
  "memoriesUsed": 3,
  "memoriesStored": 1
}
```

**Flow:**
1. Retrieve historical memories with `user_id` and `workspace_id` (RAG)
2. Assemble prompt and call LLM
3. Asynchronously evaluate information importance, store in Milvus if worthwhile

### 4. GET /api/memories - Get Memory List

**Headers:**
```
Authorization: Bearer {token}
```

**Query Parameters:**
- `workspaceId`: Workspace ID

**Response:**
```json
{
  "count": 5,
  "memories": [
    {
      "id": "uuid-123",
      "userId": "user-abc",
      "workspaceId": "workspace-123",
      "content": "User prefers Node.js for backend development",
      "score": 0
    }
  ]
}
```

### 5. PUT /api/memories/:id - Update Memory

**Headers:**
```
Authorization: Bearer {token}
```

**Request Body:**
```json
{
  "content": "Updated memory content"
}
```

**Security:** Only allows updating own memories (owner validation).

### 6. DELETE /api/memories/:id - Delete Memory

**Headers:**
```
Authorization: Bearer {token}
```

**Security:** Only allows deleting own memories (owner validation).

## Frontend Testing Page

A frontend testing page is available at `http://localhost:3000/` after starting the server. It provides:

- User registration and login
- Chat interface with AI
- Memory management (view, edit, delete)

## Tech Stack

- **Node.js + Express + TypeScript**
- **Milvus**: Vector database (using `@zilliz/milvus2-sdk-node`)
- **JWT**: Authentication
- **OpenAI Compatible API**: LLM calls and embeddings

## Core Isolation Strategy

See code comments for details. Key files to review:

1. `src/middlewares/auth.middleware.ts` - First line of defense
2. `src/services/milvus.service.ts` - Core isolation logic (all methods require `userId`)
3. `src/controllers/*.ts` - How to correctly use `req.user.userId`

## Error Handling

All service layers have comprehensive try-catch:
- Milvus connection failure
- LLM call failure
- Embedding generation failure

Errors return unified format:
```json
{
  "error": "Internal Server Error",
  "message": "Detailed error message"
}
```
