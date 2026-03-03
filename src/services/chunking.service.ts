/**
 * Chunking Service
 *
 * 将长文本分割成多个 chunk，用于 embedding 和存储
 *
 * 规则：
 * - 每个 chunk 最多 400 个 token
 * - 相邻 chunk 之间有 80 个 token 重叠
 * - 优先在句子或自然语块边界分割
 */

/**
 * Token 估算器
 * 粗略估算中英文文本的 token 数量
 * 约等于 0.25 * 字符数（中文字符数）
 */
class TokenEstimator {
  /**
   * 估算文本的 token 数量
   */
  estimateTokenCount(text: string): number {
    // 简单估算：英文约 0.25 token/字符，中文字符数 = token 数
    let charCount = 0;

    for (let i = 0; i < text.length; i++) {
      const charCode = text.charCodeAt(i);
      // 检查是否为中文字符（Unicode 范围）
      if (
        (charCode >= 0x4e00 && charCode <= 0x9fff) ||
        (charCode >= 0x3400 && charCode <= 0x4dbf) ||
        (charCode >= 0x20000 && charCode <= 0x2a6df) ||
        (charCode >= 0x2a700 && charCode <= 0x2b73f) ||
        (charCode >= 0x2b740 && charCode <= 0x2b81f)
      ) {
        // 中文字符 = 1 token
        charCount += 1;
      } else {
        // 英文字符约 0.25 token
        charCount += 0.25;
      }
    }

    return Math.ceil(charCount);
  }

  /**
   * 计算两个字符串的重叠 token 数量
   */
  calculateOverlapTokenCount(text1: string, text2: string): number {
    return this.estimateTokenCount(text1);
  }
}

export class ChunkingService {
  private tokenEstimator: TokenEstimator;
  private readonly MAX_TOKENS_PER_CHUNK = 400;
  private readonly OVERLAP_TOKENS = 80;

  constructor() {
    this.tokenEstimator = new TokenEstimator();
  }

  /**
   * 将文本分割成多个 chunk
   *
   * @param text - 要分割的文本
   * @returns 分割后的 chunk 数组
   */
  chunkText(text: string): string[] {
    if (!text || text.trim().length === 0) {
      return [];
    }

    // 预处理：规范化空白
    const normalizedText = text
      .replace(/\s+/g, ' ')  // 多个空格转为单个空格
      .replace(/\n\s*\n/g, '\n\n')  // 空行转为双换行
      .trim();

    const chunks: string[] = [];
    let currentIndex = 0;
    const totalTokens = this.tokenEstimator.estimateTokenCount(normalizedText);

    // 如果文本很短，直接返回
    if (totalTokens <= this.MAX_TOKENS_PER_CHUNK) {
      return [normalizedText];
    }

    // 第一次分割：按照 token 限制粗略分割
    let workingText = normalizedText;
    while (currentIndex < totalTokens) {
      // 尝试找一个合理的分割点（句子或段落边界）
      const { chunk, endIndex, tokenCount } = this.findChunkBoundary(
        workingText,
        currentIndex,
        totalTokens
      );

      if (chunk) {
        chunks.push(chunk);
        currentIndex = endIndex;

        // 计算下一个 chunk 的起始位置（减去重叠部分）
        // 实际上我们需要往前找重叠文本
        // endIndex 是当前 chunk 的结束位置，但可能不是句子边界
        // 我们需要往前找 80 token 的内容作为下次的起始
        const overlapText = this.extractOverlapText(chunk, this.OVERLAP_TOKENS);
        currentIndex -= overlapText.length;
      }
    }

    return chunks;
  }

  /**
   * 找到一个合理的 chunk 边界
   *
   * 策略：
   * 1. 优先在句子边界分割（.!?。！？\n）
   * 2. 其次在段落边界分割（连续换行）
   * 3. 最后在接近 MAX_TOKENS 的任意位置分割
   */
  private findChunkBoundary(
    text: string,
    globalStartIndex: number,
    totalTokens: number
  ): { chunk: string; endIndex: number; tokenCount: number } {
    const targetEndIndex = globalStartIndex + this.MAX_TOKENS_PER_CHUNK;

    // 如果剩余文本不超过限制，全部返回
    if (globalStartIndex + this.tokenEstimator.estimateTokenCount(text) <= totalTokens) {
      const lastChunkIndex = totalTokens - this.OVERLAP_TOKENS;
      return {
        chunk: text,
        endIndex: totalTokens,
        tokenCount: this.tokenEstimator.estimateTokenCount(text),
      };
    }

    // 1. 尝试找句子边界
    const sentenceBoundary = this.findSentenceBoundary(text, targetEndIndex, globalStartIndex);
    if (sentenceBoundary) {
      return sentenceBoundary;
    }

    // 2. 尝试找段落边界（双换行）
    const paragraphBoundary = this.findParagraphBoundary(text, targetEndIndex, globalStartIndex);
    if (paragraphBoundary) {
      return paragraphBoundary;
    }

    // 3. 使用目标位置硬分割
    // 从当前位置开始，找最近的字符位置
    let currentIndex = 0;
    let accumulatedTokens = 0;

    while (currentIndex < text.length) {
      const char = text[currentIndex];

      // 粗略估算当前字符的 token
      let charTokens = 0.25; // 英文默认
      if (
        (char.charCodeAt(0) >= 0x4e00 && char.charCodeAt(0) <= 0x9fff) ||
        (char.charCodeAt(0) >= 0x3400 && char.charCodeAt(0) <= 0x4dbf) ||
        (char.charCodeAt(0) >= 0x20000 && char.charCodeAt(0) <= 0x2a6df) ||
        (char.charCodeAt(0) >= 0x2a700 && char.charCodeAt(0) <= 0x2b73f) ||
        (char.charCodeAt(0) >= 0x2b740 && char.charCodeAt(0) <= 0x2b81f)
      ) {
        charTokens = 1; // 中文
      }

      accumulatedTokens += charTokens;

      // 如果加上这个字符会超出限制，在这里分割
      if (globalStartIndex + accumulatedTokens >= targetEndIndex) {
        const chunk = text.substring(0, currentIndex + 1);
        const chunkTokens = this.tokenEstimator.estimateTokenCount(chunk);
        return {
          chunk,
          endIndex: globalStartIndex + chunkTokens,
          tokenCount: chunkTokens,
        };
      }

      currentIndex++;
    }

    // 理论上不应该到这里，但作为 fallback
    return {
      chunk: text,
      endIndex: targetEndIndex,
      tokenCount: this.tokenEstimator.estimateTokenCount(text),
    };
  }

  /**
   * 在句子边界找分割点
   */
  private findSentenceBoundary(
    text: string,
    targetEndIndex: number,
    globalStartIndex: number
  ): { chunk: string; endIndex: number; tokenCount: number } | null {
    const sentenceEnders = ['.', '!', '?', '。', '！', '？'];
    const currentTextEnd = text.length;

    // 在目标位置附近找句子结尾
    const searchStart = Math.max(0, targetEndIndex - globalStartIndex - 50); // 往前 50 token 范围内搜索
    const searchEnd = Math.min(targetEndIndex - globalStartIndex, currentTextEnd);

    let bestMatchIndex = -1;

    for (let i = searchStart; i <= searchEnd; i++) {
      const char = text[i];
      if (sentenceEnders.includes(char)) {
        // 检查分割后剩余的内容是否还有足够的内容
        const afterSplit = text.substring(i + 1);
        const afterSplitTokens = this.tokenEstimator.estimateTokenCount(afterSplit);

        if (afterSplitTokens >= 30) { // 剩余至少 30 token
          bestMatchIndex = i + 1; // 在句子后面分割
          break;
        }
      }
    }

    if (bestMatchIndex > 0) {
      const chunk = text.substring(0, bestMatchIndex);
      return {
        chunk,
        endIndex: globalStartIndex + bestMatchIndex,
        tokenCount: this.tokenEstimator.estimateTokenCount(chunk),
      };
    }

    return null;
  }

  /**
   * 在段落边界找分割点（双换行）
   */
  private findParagraphBoundary(
    text: string,
    targetEndIndex: number,
    globalStartIndex: number
  ): { chunk: string; endIndex: number; tokenCount: number } | null {
    const paragraphPattern = /\n\s*\n/;
    const matches = Array.from(text.matchAll(paragraphPattern));

    // 找最接近目标位置的段落边界
    let bestMatchIndex = -1;
    let currentPos = 0;

    for (const match of matches) {
      if (match.index !== undefined) {
        const matchEnd = match.index + match[0].length;

        // 检查是否在目标位置附近
        const distance = Math.abs(matchEnd - targetEndIndex);

        if (distance < 100 && matchEnd < text.length * 0.8) { // 在 100 token 内，且不是最后 20%
          if (bestMatchIndex === -1 || matchEnd < bestMatchIndex) {
            bestMatchIndex = matchEnd;
          }
        }
      }
    }

    if (bestMatchIndex > 0) {
      const chunk = text.substring(0, bestMatchIndex);
      return {
        chunk,
        endIndex: globalStartIndex + bestMatchIndex,
        tokenCount: this.tokenEstimator.estimateTokenCount(chunk),
      };
    }

    return null;
  }

  /**
   * 提取文本的末尾部分作为重叠内容
   */
  private extractOverlapText(text: string, overlapTokens: number): string {
    if (text.length <= 10) {
      return ''; // 文本太短，不提供重叠
    }

    // 从文本末尾开始，往前取 overlapTokens
    // 但不能超过文本长度的一半
    const maxOverlapLength = Math.floor(text.length / 2);
    const targetLength = Math.min(overlapTokens * 4, maxOverlapLength); // token 到字符粗略转换

    return text.slice(-targetLength);
  }

  /**
   * 获取 chunk 统计信息
   */
  getChunkStats(chunks: string[]): {
    total: number;
    chunks: number;
    avgTokens: number;
    minTokens: number;
    maxTokens: number;
  } {
    const stats = {
      total: 0,
      chunks: chunks.length,
      avgTokens: 0,
      minTokens: Infinity,
      maxTokens: 0,
    };

    const tokenCounts = chunks.map((chunk) =>
      this.tokenEstimator.estimateTokenCount(chunk)
    );

    for (const count of tokenCounts) {
      stats.total += count;
      stats.minTokens = Math.min(stats.minTokens, count);
      stats.maxTokens = Math.max(stats.maxTokens, count);
    }

    stats.avgTokens = stats.total / stats.chunks;

    return stats;
  }
}

export const chunkingService = new ChunkingService();
