# Multi-Assistant AI Backend

基于 Express + TypeScript 的多租户 AI 后端服务，实现严格的用户数据隔离和 AI 记忆系统。

## 核心特性

### 1. 严格的多租户数据隔离

**双重隔离机制：**
- **第一层：JWT 鉴权中间件**
  - 所有 `/api/*` 请求必须携带有效 JWT token
  - 从 token 提取 `user_id` 并挂载到 `req.user.userId`

- **第二层：Milvus 数据层强制校验**
  - Collection Schema 中 `user_id` 设为 **Partition Key**
  - 所有 CRUD 方法强制接收 `user_id` 参数
  - 查询时强制拼接 `user_id == "{userId}"` 过滤条件

**安全保证：** 即使恶意请求绕过鉴权层，数据层仍然无法越权访问。

### 2. AI 记忆系统

- **智能记忆存储**：使用 LLM 判断对话信息重要性，避免数据库膨胀
- **向量检索 (RAG)**：基于语义相似度检索相关历史记忆
- **Workspace 隔离**：同一用户可在不同 workspace 下维护独立记忆

## 项目结构

```
src/
├── config/              # 配置文件
├── middlewares/         # JWT 鉴权中间件
├── services/            # 核心服务层
│   ├── milvus.service.ts    # Milvus 封装（核心隔离逻辑）
│   ├── embedding.service.ts # 向量化服务
│   ├── llm.service.ts       # LLM 调用封装
│   └── memory.service.ts    # 记忆管理
├── controllers/         # 控制器层
├── routes/              # 路由层
├── types/               # TypeScript 类型定义
└── utils/               # 工具函数
```

## 快速开始

### 1. 启动 Milvus

```bash
docker-compose up -d
```

等待 Milvus 启动完成（大约 30-60 秒）。

### 2. 安装依赖

```bash
npm install
```

### 3. 配置环境变量

复制 `.env.example` 为 `.env` 并填写 API keys：

```bash
cp .env.example .env
```

编辑 `.env`：
- `LLM_BASE_URL`: 私有模型服务地址（如 `http://localhost:8000/v1`）
- `LLM_MODEL`: LLM 模型名称（如 `gpt-4`）
- `LLM_EMBEDDING_MODEL`: Embedding 模型名称（如 `text-embedding-ada-002`）
- `LLM_API_KEY`: 如果私有模型需要认证则填写
- `JWT_SECRET`: 生产环境请修改

### 4. 启动服务

```bash
npm run dev
```

服务将在 `http://localhost:3000` 启动。

## API 接口

### 1. POST /api/chat - 核心对话接口

**请求体：**
```json
{
  "workspaceId": "my-workspace-123",
  "message": "帮我写一个 RESTful API"
}
```

**响应：**
```json
{
  "response": "我可以帮你设计一个 RESTful API...",
  "memoriesUsed": 3,
  "memoriesStored": 1
}
```

**流程：**
1. 携带 `user_id` 和 `workspace_id` 检索历史记忆（RAG）
2. 组装 Prompt 并调用 LLM
3. 异步判断信息重要性，如值得则存入 Milvus

### 2. GET /api/memories - 获取记忆列表

**Query 参数：**
- `workspaceId`: 工作空间 ID

**响应：**
```json
{
  "count": 5,
  "memories": [
    {
      "id": "uuid-123",
      "userId": "user-abc",
      "workspaceId": "workspace-123",
      "content": "用户喜欢用 Node.js 开发后端服务",
      "score": 0
    }
  ]
}
```

### 3. PUT /api/memories/:id - 更新记忆

**请求体：**
```json
{
  "content": "更新后的记忆内容"
}
```

**安全：** 只允许更新自己的记忆（owner 校验）。

### 4. DELETE /api/memories/:id - 删除记忆

**安全：** 只允许删除自己的记忆（owner 校验）。

## JWT Token 生成（测试用）

```typescript
import { generateToken } from './src/middlewares/auth.middleware';

const token = generateToken('user-test-123');
console.log(token);
```

然后使用 `Authorization: Bearer {token}` header 访问 API。

## 技术栈

- **Node.js + Express + TypeScript**
- **Milvus**: 向量数据库（使用 `@zilliz/milvus2-sdk-node`）
- **JWT**: 身份验证
- **Anthropic Claude**: LLM 调用
- **OpenAI Embeddings**: 文本向量化

## 核心隔离策略说明

详见代码注释，重点关注：

1. `src/middlewares/auth.middleware.ts` - 第一道防线
2. `src/services/milvus.service.ts` - 核心隔离逻辑（所有方法强制 `userId`）
3. `src/controllers/*.ts` - 如何正确使用 `req.user.userId`

## 错误处理

所有服务层都有完善的 try-catch：
- Milvus 连接失败
- LLM 调用失败
- Embedding 生成失败

错误会返回统一的错误格式：
```json
{
  "error": "Internal Server Error",
  "message": "详细错误信息"
}
```
