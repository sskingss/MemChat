#!/bin/bash

# MemChat Demo Setup Script
# This script helps you quickly set up and run the MemChat demo

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}╔════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║           MemChat Interactive Persona Demo                     ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════════════════════╝${NC}"
echo ""

# Check Node.js
echo -e "${YELLOW}[1/4] Checking prerequisites...${NC}"
if !command -v node &> /dev/null; then
    echo -e "${RED}✗ Node.js is not installed${NC}"
    echo "  Please install Node.js 18+ from https://nodejs.org/"
    exit 1
fi
echo -e "${GREEN}✓ Node.js $(node -v) installed${NC}"

# Check Docker
if !command -v docker &> /dev/null; then
    echo -e "${RED}✗ Docker is not installed${NC}"
    echo "  Please install Docker from https://www.docker.com/"
    exit 1
fi
echo -e "${GREEN}✓ Docker installed${NC}"

# Check if .env exists
if [ ! -f .env ]; then
    echo ""
    echo -e "${YELLOW}[2/4] Creating .env configuration...${NC}"
    cp .env.example .env
    echo -e "${GREEN}✓ Created .env from .env.example${NC}"
    echo ""
    echo -e "${YELLOW}Please configure your LLM API:${NC}"
    echo "  1. Open .env file"
    echo "  2. Set LLM_API_KEY (your API key)"
    echo "  3. Set LLM_BASE_URL (API endpoint)"
    echo "  4. Set LLM_MODEL (model name)"
    echo ""
    read -p "Press Enter to open .env in your editor... " -n1
    ${EDITOR:-nano} .env
else
    echo -e "${GREEN}✓ .env already exists${NC}"
fi

# Install dependencies
echo ""
echo -e "${YELLOW}[3/4] Installing dependencies...${NC}"
npm install
echo -e "${GREEN}✓ Dependencies installed${NC}"

# Start Milvus with Docker
echo ""
echo -e "${YELLOW}[4/4] Starting Milvus (vector database)...${NC}"
docker-compose up -d
sleep 5  # Wait for Milvus to start
echo -e "${GREEN}✓ Milvus started${NC}"

# Start the server
echo ""
echo -e "${GREEN}╔════════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║                    Starting MemChat Server                      ║${NC}"
echo -e "${GREEN}╚════════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "${BLUE}  ➤ Web UI: ${NC}http://localhost:3000"
echo -e "${BLUE}  ➤ API Docs: ${NC}See README.md"
echo ""
echo -e "${YELLOW}Tip: First time? Create your AI persona through the bootstrap flow!${NC}"
echo ""

npm run dev
