# Quick Demo Deployment Guide

This guide helps you quickly deploy and experience MemChat's **Interactive Persona Creation** feature.

## Prerequisites

- Docker & Docker Compose
- Node.js 18+
- An OpenAI-compatible LLM API (OpenAI, Azure, ByteDance Ark, etc.)

## One-Click Start

```bash
# Make the script executable
chmod +x demo.sh

# Run the demo setup
./demo.sh
```

Or manually:

```bash
# 1. Start Milvus (vector database)
docker-compose up -d

# 2. Install dependencies
npm install

# 3. Configure environment
cp .env.example .env
# Edit .env with your LLM API settings

# 4. Start server
npm run dev
```

Visit http://localhost:3000

## Environment Configuration

```env
# Server
PORT=3000

# JWT Secret (change in production!)
JWT_SECRET=your-secret-key

# LLM Configuration
LLM_API_KEY=your-api-key
LLM_BASE_URL=https://api.openai.com/v1
LLM_MODEL=gpt-4

# Milvus (defaults work for local Docker)
MILVUS_ADDRESS=localhost:19530
```

### LLM Provider Examples

**OpenAI:**
```env
LLM_API_KEY=sk-xxx
LLM_BASE_URL=https://api.openai.com/v1
LLM_MODEL=gpt-4
```

**Azure OpenAI:**
```env
LLM_API_KEY=your-azure-key
LLM_BASE_URL=https://your-resource.openai.azure.com/openai/deployments/your-deployment
LLM_MODEL=gpt-4
```

**ByteDance Ark:**
```env
LLM_API_KEY=your-ark-api-key
LLM_BASE_URL=https://ark-cn-beijing.bytedance.net/api/v3
LLM_MODEL=your-endpoint-id
```

**Local LLM (Ollama/LMStudio):**
```env
LLM_API_KEY=not-needed
LLM_BASE_URL=http://localhost:11434/v1
LLM_MODEL=llama3
```

## Demo Flow

### 1. Register/Login

On the web UI (http://localhost:3000), enter any username and click "Register" or "Login".

### 2. Create Your AI Persona (New Feature!)

After login, you'll enter the **Persona Bootstrap** flow - an interactive conversation to create your personalized AI:

```
Phase 1 - Hello: Choose your preferred language
Phase 2 - You: Tell about yourself and your needs
Phase 3 - Personality: Define how AI should communicate
Phase 4 - Depth: Set boundaries and failure philosophy
```

The AI naturally converses with you to understand your preferences, then creates a personalized persona.

### 3. Chat with Your AI

After persona creation:
- Your AI uses your defined personality and communication style
- Memories are stored and retrieved automatically
- Try different workspaces to see memory isolation

### 4. Manage Your Persona

Click "Edit Persona" to modify your AI's personality, or "Delete Persona" to start over.

## Troubleshooting

### Milvus Connection Failed
```bash
# Check if Milvus is running
docker-compose ps

# Restart Milvus
docker-compose restart
```

### LLM API Errors
- Check if your API key is valid
- Verify the base URL is correct
- Ensure you have sufficient API credits

### Port Already in Use
```bash
# Change PORT in .env
PORT=3001
```

### TypeScript Errors
```bash
# Clean install
rm -rf node_modules
npm install
```

## Architecture

```
┌─────────────────────────────────────────────┐
│  Browser (http://localhost:3000)            │
│  - Interactive Persona Bootstrap UI         │
│  - Chat Interface                           │
│  - Memory Management                        │
└─────────────────────────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────────┐
│  Express Server (Node.js)                   │
│  - Persona Bootstrap Service                │
│  - LLM Service                              │
│  - Memory Service                           │
└─────────────────────────────────────────────┘
                    │
        ┌───────────┴───────────┐
        ▼                       ▼
┌─────────────┐         ┌─────────────┐
│ LLM API     │         │ Milvus      │
│ (GPT-4, etc)│         │ (Vector DB) │
└─────────────┘         └─────────────┘
```

## Key Features

- **Interactive Persona Creation**: 4-phase conversation to personalize your AI
- **Persistent Memory**: AI remembers across sessions
- **Multi-Workspace**: Separate contexts for different projects
- **User Isolation**: Secure multi-tenant architecture

## Next Steps

1. Try different workspaces to see memory isolation
2. Edit your persona to fine-tune AI behavior
3. Check memory management to see what AI remembers
4. Test the bootstrap flow with a new user account
