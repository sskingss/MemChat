import { Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { generateToken } from '../middlewares/auth.middleware';
import { AuthError } from '../utils/errors';

/**
 * 用户注册
 *
 * 简化实现：无需密码，直接生成用户 ID 并返回 token
 */
export const register = (req: Request, res: Response) => {
  try {
    const { username } = req.body;

    if (!username || typeof username !== 'string') {
      res.status(400).json({
        error: 'Bad Request',
        message: 'username 是必填字段',
      });
      return;
    }

    // 生成用户 ID
    const userId = uuidv4();

    // 生成 JWT token
    const token = generateToken(userId);

    res.status(201).json({
      userId,
      username,
      token,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({
      error: 'Internal Server Error',
      message: `注册失败: ${message}`,
    });
  }
};

/**
 * 用户登录
 *
 * 简化实现：使用 username 返回 token
 * 实际项目中应该验证密码等凭据
 */
export const login = (req: Request, res: Response) => {
  try {
    const { username } = req.body;

    if (!username || typeof username !== 'string') {
      res.status(400).json({
        error: 'Bad Request',
        message: 'username 是必填字段',
      });
      return;
    }

    // 简化版：直接使用 username 作为 userId 的种子
    // 实际项目中应该从数据库查找用户
    const userId = username; // 简化实现，实际应该从数据库获取

    // 生成 JWT token
    const token = generateToken(userId);

    res.json({
      userId,
      username,
      token,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({
      error: 'Internal Server Error',
      message: `登录失败: ${message}`,
    });
  }
};
