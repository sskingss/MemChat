import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { memoryService } from '../services/memory.service';
import { embeddingService } from '../services/embedding.service';
import { milvusService } from '../services/milvus.service';
import { personaService } from '../services/persona.service';
import { memoryGraphService } from '../services/memory-graph.service';
import { emotionService } from '../services/emotion.service';

/**
 * MemChat MCP Server
 *
 * 将 MemChat 的核心能力暴露为 MCP Tools，使其可被
 * Claude Desktop、Cursor 等 MCP 客户端直接调用。
 *
 * 提供的 Tools:
 * - remember: 存储一条记忆
 * - recall: 检索相关记忆
 * - forget: 删除一条记忆
 * - list_memories: 列出 workspace 下所有记忆
 * - get_persona: 获取用户人格
 * - get_emotion: 获取情绪状态
 * - get_graph: 获取知识图谱
 */
export async function startMCPServer() {
  const server = new Server(
    { name: 'memchat', version: '1.0.0' },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: 'remember',
        description: 'Store a new memory for a user in a workspace. The memory will be vectorized and stored for future retrieval.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            userId: { type: 'string', description: 'User ID' },
            workspaceId: { type: 'string', description: 'Workspace ID' },
            content: { type: 'string', description: 'Memory content to store' },
            category: { type: 'string', enum: ['semantic', 'episodic', 'procedural', 'todo'], description: 'Memory category' },
            importance: { type: 'number', description: 'Importance score 1-10', default: 5 },
          },
          required: ['userId', 'workspaceId', 'content'],
        },
      },
      {
        name: 'recall',
        description: 'Search for relevant memories based on a query. Uses hybrid retrieval (vector + keyword + time decay).',
        inputSchema: {
          type: 'object' as const,
          properties: {
            userId: { type: 'string', description: 'User ID' },
            workspaceId: { type: 'string', description: 'Workspace ID' },
            query: { type: 'string', description: 'Search query' },
            topK: { type: 'number', description: 'Number of results', default: 5 },
          },
          required: ['userId', 'workspaceId', 'query'],
        },
      },
      {
        name: 'forget',
        description: 'Delete a specific memory by its ID.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            userId: { type: 'string', description: 'User ID' },
            memoryId: { type: 'string', description: 'Memory ID to delete' },
          },
          required: ['userId', 'memoryId'],
        },
      },
      {
        name: 'list_memories',
        description: 'List all memories in a workspace.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            userId: { type: 'string', description: 'User ID' },
            workspaceId: { type: 'string', description: 'Workspace ID' },
          },
          required: ['userId', 'workspaceId'],
        },
      },
      {
        name: 'get_persona',
        description: 'Get the AI persona configuration for a user.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            userId: { type: 'string', description: 'User ID' },
          },
          required: ['userId'],
        },
      },
      {
        name: 'get_emotion',
        description: 'Get the emotional state timeline for a user.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            userId: { type: 'string', description: 'User ID' },
            days: { type: 'number', description: 'Number of days to look back', default: 7 },
          },
          required: ['userId'],
        },
      },
      {
        name: 'get_graph',
        description: 'Get the knowledge graph (entities and relations) for a user.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            userId: { type: 'string', description: 'User ID' },
            limit: { type: 'number', description: 'Max entities to return', default: 100 },
          },
          required: ['userId'],
        },
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    switch (name) {
      case 'remember': {
        const { userId, workspaceId, content, category, importance } = args as any;
        const vector = await embeddingService.generateEmbedding(content);
        const id = await milvusService.insertMemory(
          userId, workspaceId, content, vector,
          category === 'todo' ? 'todo' : 'general',
          0, importance || 5, 0, category
        );
        return { content: [{ type: 'text', text: JSON.stringify({ success: true, memoryId: id }) }] };
      }

      case 'recall': {
        const { userId, workspaceId, query, topK } = args as any;
        const memories = await memoryService.retrieveRelevantMemories(userId, workspaceId, query, topK || 5);
        return { content: [{ type: 'text', text: JSON.stringify({ memories, count: memories.length }) }] };
      }

      case 'forget': {
        const { userId, memoryId } = args as any;
        const success = await milvusService.deleteMemory(userId, memoryId);
        return { content: [{ type: 'text', text: JSON.stringify({ success }) }] };
      }

      case 'list_memories': {
        const { userId, workspaceId } = args as any;
        const memories = await milvusService.getMemoriesByWorkspace(userId, workspaceId);
        return { content: [{ type: 'text', text: JSON.stringify({ memories, count: memories.length }) }] };
      }

      case 'get_persona': {
        const { userId } = args as any;
        const persona = await personaService.getUserPersona(userId);
        return { content: [{ type: 'text', text: JSON.stringify({ hasPersona: !!persona, persona }) }] };
      }

      case 'get_emotion': {
        const { userId, days } = args as any;
        const timeline = emotionService.getTimeline(userId, days || 7);
        return { content: [{ type: 'text', text: JSON.stringify(timeline) }] };
      }

      case 'get_graph': {
        const { userId, limit } = args as any;
        const graph = memoryGraphService.getGraph(userId, limit || 100);
        return { content: [{ type: 'text', text: JSON.stringify(graph) }] };
      }

      default:
        return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true };
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.log('[MCP] MemChat MCP Server started on stdio');
}
