import { Request, Response } from 'express';
import { milvusService } from '../services/milvus.service';
import { generateToken } from '../middlewares/auth.middleware';

/**
 * 用户注册
 *
 * 如果用户已存在，返回现有用户信息；
 * 否则创建新用户并返回 token
 * 同时检查用户是否已创建人格配置
 */
export const register = async (req: Request, res: Response) => {
  try {
    const { username } = req.body;

    if (!username || typeof username !== 'string') {
      res.status(400).json({
        error: 'Bad Request',
        message: 'username 是必填字段',
      });
      return;
    }

    // 验证 username 只能包含字母
    if (!/^[a-zA-Z]+$/.test(username)) {
      res.status(400).json({
        error: 'Bad Request',
        message: 'username 只能包含字母 (a-z, A-Z)',
      });
      return;
    }

    // 注册或获取用户（保证同一 username 对应同一 userId）
    const user = await milvusService.registerOrGetUser(username);

    // 检查用户是否已创建人格
    const persona = await milvusService.queryUserPersona(user.userId);

    // 生成 JWT token
    const token = generateToken(user.userId);

    res.status(201).json({
      userId: user.userId,
      username: user.username,
      token,
      hasPersona: !!persona, // 是否已创建人格
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
 * 如果用户已存在，返回 token；
 * 如果用户不存在，自动创建新用户
 * 同时检查用户是否已创建人格配置
 */
export const login = async (req: Request, res: Response) => {
  try {
    const { username } = req.body;

    if (!username || typeof username !== 'string') {
      res.status(400).json({
        error: 'Bad Request',
        message: 'username 是必填字段',
      });
      return;
    }

    // 验证 username 只能包含字母
    if (!/^[a-zA-Z]+$/.test(username)) {
      res.status(400).json({
        error: 'Bad Request',
        message: 'username 只能包含字母 (a-z, A-Z)',
      });
      return;
    }

    // 登录或注册（保证同一 username 对应同一 userId）
    const user = await milvusService.registerOrGetUser(username);

    // 检查用户是否已创建人格
    const persona = await milvusService.queryUserPersona(user.userId);

    // 生成 JWT token
    const token = generateToken(user.userId);

    res.json({
      userId: user.userId,
      username: user.username,
      token,
      hasPersona: !!persona, // 是否已创建人格
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({
      error: 'Internal Server Error',
      message: `登录失败: ${message}`,
    });
  }
};
