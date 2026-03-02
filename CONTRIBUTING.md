# Contributing to MemChat

First off, thank you for considering contributing to MemChat! It's people like you that make MemChat such a great tool.

## 📋 Table of Contents

- [Code of Conduct](#code-of-conduct)
- [How Can I Contribute?](#how-can-i-contribute)
- [Development Setup](#development-setup)
- [Coding Standards](#coding-standards)
- [Commit Guidelines](#commit-guidelines)
- [Pull Request Process](#pull-request-process)

## Code of Conduct

This project and everyone participating in it is governed by the MemChat Code of Conduct. By participating, you are expected to uphold this code. Please report unacceptable behavior to the project maintainers.

## How Can I Contribute?

### Report Bugs

Before creating bug reports, please check the issue list as you might find out that you don't need to create one. When you are creating a bug report, please include as many details as possible:

- **Use a clear and descriptive title**
- **Describe the exact steps to reproduce the problem**
- **Provide specific examples to demonstrate the steps**
- **Describe the behavior you observed and what you expected**
- **Include screenshots or animated GIFs if helpful**
- **Include your environment details** (OS, Node version, etc.)

### Suggest Enhancements

Enhancement suggestions are tracked as GitHub issues. When creating an enhancement suggestion, include:

- **Use a clear and descriptive title**
- **Provide a step-by-step description of the suggested enhancement**
- **Provide specific examples to demonstrate the steps**
- **Describe the current behavior and explain the expected behavior**
- **Explain why this enhancement would be useful**

### Pull Requests

- Fill in the required template
- Do not include issue numbers in the PR title
- Include screenshots and animated GIFs in your pull request whenever possible
- Follow the coding standards
- Include tests for new features
- Update documentation for changed functionality

## Development Setup

### Prerequisites

- Node.js 18+
- Docker & Docker Compose
- Git

### Setup Steps

1. Fork the repository
2. Clone your fork:
   ```bash
   git clone https://github.com/your-username/memchat.git
   cd memchat
   ```
3. Install dependencies:
   ```bash
   npm install
   ```
4. Start Milvus:
   ```bash
   docker-compose up -d
   ```
5. Create a branch for your changes:
   ```bash
   git checkout -b feature/your-feature-name
   ```
6. Make your changes and test them:
   ```bash
   npm run dev
   ```

## Coding Standards

### TypeScript

- Use TypeScript for all new code
- Define proper types in `src/types/`
- Avoid `any` type when possible
- Use interfaces for object shapes

### Code Style

- Use meaningful variable and function names
- Add JSDoc comments for public functions
- Keep functions small and focused
- Follow the existing code structure

### File Organization

```
src/
├── config/           # Environment and app configuration
├── middlewares/      # Express middlewares
├── services/         # Business logic and external integrations
├── controllers/      # Request handlers
├── routes/           # API route definitions
├── types/            # TypeScript type definitions
└── utils/            # Helper functions
```

### Example Code Structure

```typescript
// Good: Clear, typed, documented
interface UserMemory {
  id: string;
  userId: string;
  workspaceId: string;
  content: string;
  embedding?: number[];
}

/**
 * Retrieves memories for a specific user and workspace
 * @param userId - The user's unique identifier
 * @param workspaceId - The workspace identifier
 * @returns Array of memories
 */
async function getMemories(userId: string, workspaceId: string): Promise<UserMemory[]> {
  // Implementation
}
```

## Commit Guidelines

We follow conventional commits:

- `feat:` - A new feature
- `fix:` - A bug fix
- `docs:` - Documentation only changes
- `style:` - Changes that do not affect the meaning of the code
- `refactor:` - A code change that neither fixes a bug nor adds a feature
- `test:` - Adding missing tests or correcting existing tests
- `chore:` - Changes to the build process or auxiliary tools

Examples:
```
feat: add streaming support for chat responses
fix: resolve JWT token expiration issue
docs: update API documentation for memory endpoints
refactor: simplify embedding service initialization
```

## Pull Request Process

1. **Update Documentation**: Ensure any new features or changed behavior is documented in README.md

2. **Update CHANGELOG**: Add your changes to the changelog (if one exists)

3. **Test Your Changes**: Make sure all existing functionality still works

4. **Link Issues**: Link any relevant issues in your PR description

5. **Request Review**: Request a review from a maintainer

6. **Address Feedback**: Make any requested changes and re-push

### PR Checklist

- [ ] Code follows the project's coding standards
- [ ] All new code is TypeScript typed
- [ ] Documentation is updated
- [ ] No sensitive information is committed
- [ ] Commit messages follow the guidelines
- [ ] Self-review of the code has been performed

## Questions?

Feel free to open an issue with the `question` label if you have any questions about contributing!

Thank you for your contributions! 🎉
