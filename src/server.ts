import app from './app';
import { config, validateConfig } from './config';
import { milvusService } from './services/milvus.service';
import { embeddingService } from './services/embedding.service';
import { personaService } from './services/persona.service';
import { cleanupService } from './services/cleanup.service';
import { compressionService } from './services/compression.service';
import { quotaService } from './services/quota.service';
import { memoryGraphService } from './services/memory-graph.service';
import { emotionService } from './services/emotion.service';
import { personaEvolutionService } from './services/persona-evolution.service';

/**
 * 服务启动入口
 *
 * 启动流程：
 * 1. 校验配置
 * 2. 预加载 Embedding 模型
 * 3. 初始化 Milvus Collection
 * 4. 初始化人格系统
 * 5. 初始化新增服务（配额、图谱、情绪、人格进化）
 * 6. 启动清理服务
 * 7. 启动 Express 服务器
 */
async function startServer() {
  try {
    console.log('[Startup] 校验配置...');
    validateConfig();

    console.log('[Startup] 预加载 Embedding 模型...');
    await embeddingService.init();

    console.log('[Startup] 初始化 Milvus Collection...');
    await milvusService.initCollection();

    console.log('[Startup] 初始化人格系统...');
    await personaService.init();

    // 新增服务初始化
    console.log('[Startup] 初始化配额管理服务...');
    await quotaService.init();

    console.log('[Startup] 初始化知识图谱服务...');
    await memoryGraphService.init();

    console.log('[Startup] 初始化情绪追踪服务...');
    await emotionService.init();

    console.log('[Startup] 初始化人格进化服务...');
    await personaEvolutionService.init();

    console.log('[Startup] 启动清理服务...');
    cleanupService.start();

    if (config.compression.enabled) {
      console.log('[Startup] 启动记忆压缩服务...');
      compressionService.startScheduledCompression(async () => {
        return [];
      });
    }

    app.listen(config.port, () => {
      console.log(`[Startup] MemChat 服务器启动成功！`);
      console.log(`[Startup] 环境: ${config.nodeEnv}`);
      console.log(`[Startup] 端口: ${config.port}`);
      console.log(`[Startup] 健康检查: http://localhost:${config.port}/health`);
      console.log(`[Startup] Prometheus: http://localhost:${config.port}/metrics`);
      console.log(`[Startup] 特性: Redis=${!!config.redis?.url}, Quota=${config.quota.enabled}, Graph=${config.graph.enabled}, Emotion=${config.emotion.enabled}, PersonaEvolution=${config.personaEvolution.enabled}`);
    });
  } catch (error) {
    console.error('[Startup] 启动失败:', error);
    process.exit(1);
  }
}

startServer();
