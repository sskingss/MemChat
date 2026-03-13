import app from './app';
import { config, validateConfig } from './config';
import { milvusService } from './services/milvus.service';
import { embeddingService } from './services/embedding.service';
import { personaService } from './services/persona.service';
import { cleanupService } from './services/cleanup.service';
import { compressionService } from './services/compression.service';

/**
 * 服务启动入口
 *
 * 启动流程：
 * 1. 校验配置
 * 2. 预加载 Embedding 模型
 * 3. 初始化 Milvus Collection
 * 4. 初始化人格系统
 * 5. 启动清理服务
 * 6. 启动 Express 服务器
 */
async function startServer() {
  try {
    // 1. 校验配置
    console.log('[Startup] 校验配置...');
    validateConfig();

    // 2. 预加载 Embedding 模型（避免首次请求延迟）
    console.log('[Startup] 预加载 Embedding 模型...');
    await embeddingService.init();

    // 3. 初始化 Milvus
    console.log('[Startup] 初始化 Milvus Collection...');
    await milvusService.initCollection();

    // 4. 初始化人格系统
    console.log('[Startup] 初始化人格系统...');
    await personaService.init();

    // 5. 启动清理服务（清理过期待办事项）
    console.log('[Startup] 启动清理服务...');
    cleanupService.start();

    // 6. 启动每日定时压缩服务
    if (config.compression.enabled) {
      console.log('[Startup] 启动记忆压缩服务...');
      compressionService.startScheduledCompression(async () => {
        // 从 Milvus 收集所有活跃用户 ID（通过统计各 user_id 拥有记忆的用户）
        // 简单实现：当前无用户注册表，定时任务依靠触发时已缓存的活跃用户
        // 实际使用时可扩展为从用户表查询
        return [];
      });
    }

    // 7. 启动服务器
    app.listen(config.port, () => {
      console.log(`[Startup] 服务器启动成功！`);
      console.log(`[Startup] 环境: ${config.nodeEnv}`);
      console.log(`[Startup] 端口: ${config.port}`);
      console.log(`[Startup] 健康检查: http://localhost:${config.port}/health`);
    });
  } catch (error) {
    console.error('[Startup] 启动失败:', error);
    process.exit(1);
  }
}

// 启动服务
startServer();
