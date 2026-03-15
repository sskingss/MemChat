/**
 * MCP Server 独立入口
 *
 * 用法：npx tsx src/mcp/index.ts
 *
 * 该脚本以 stdio 模式启动 MCP Server，供 Claude Desktop / Cursor 等客户端调用。
 */
import { embeddingService } from '../services/embedding.service';
import { milvusService } from '../services/milvus.service';
import { memoryGraphService } from '../services/memory-graph.service';
import { emotionService } from '../services/emotion.service';
import { startMCPServer } from './server';

async function main() {
  console.error('[MCP Startup] 初始化服务...');

  await embeddingService.init();
  await milvusService.initCollection();
  await memoryGraphService.init();
  await emotionService.init();

  console.error('[MCP Startup] 启动 MCP Server...');
  await startMCPServer();
}

main().catch((err) => {
  console.error('[MCP] Fatal error:', err);
  process.exit(1);
});
