# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.0.0] - 2026-03-02

### Added

- **Core Features**

  - Multi-tenant AI memory system with strict data isolation
  - JWT-based authentication system
  - Workspace-based memory organization
  - Intelligent memory evaluation using LLM
  - Semantic search with vector embeddings
  - RESTful API with full CRUD operations
- **Security**

  - Dual-layer data isolation (JWT + database partition key)
  - Automatic memory ownership verification
  - Input validation on all endpoints
  - Environment-based configuration
- **Developer Experience**

  - Interactive testing UI
  - Docker Compose setup for Milvus
  - TypeScript for type safety
  - Comprehensive error handling
  - Detailed API documentation
- **Infrastructure**

  - Milvus 2.4 vector database integration
  - Local embedding support with @xenova/transformers
  - OpenAI-compatible LLM integration
  - Hot-reload development server

### Security

- JWT token authentication
- User data isolation at database level
- No plaintext secrets in codebase

### Documentation

- Comprehensive README with architecture diagrams
- API endpoint documentation
- Contributing guidelines
- Quick start guide

## [1.0.0-alpha] - 2026-02-28

### Added

- Initial project structure
- Basic Express server setup
- Milvus integration
- LLM service wrapper
- Embedding service
