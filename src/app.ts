import express from 'express';
import path from 'path';
import { config } from './config';
import apiRoutes from './routes';

const app = express();

// 中间件：解析 JSON 请求体
app.use(express.json());

// 中间件：解析 URL-encoded 请求体
app.use(express.urlencoded({ extended: true }));

// 静态文件服务（前端验证页面）
app.use(express.static(path.join(__dirname, '../public')));

// 健康检查接口（无需鉴权）
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    environment: config.nodeEnv,
  });
});

// API 路由（需要鉴权）
app.use('/api', apiRoutes);

// 404 处理
app.use((req, res) => {
  res.status(404).json({
    error: 'Not Found',
    message: `路由 ${req.method} ${req.path} 不存在`,
  });
});

// 全局错误处理
app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('[Global Error Handler]', err);

  res.status(500).json({
    error: 'Internal Server Error',
    message: config.nodeEnv === 'development' ? err.message : '服务器内部错误',
  });
});

export default app;
