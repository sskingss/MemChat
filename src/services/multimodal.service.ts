import fs from 'fs';
import path from 'path';
import { config } from '../config';
import { embeddingService } from './embedding.service';
import { milvusService } from './milvus.service';
import { chunkingService } from './chunking.service';

export interface ImportResult {
  totalChunks: number;
  memoriesCreated: number;
  errors: string[];
}

/**
 * 多模态记忆导入服务
 *
 * 支持将多种格式的内容导入为长期记忆：
 * - 纯文本 / Markdown
 * - JSON 结构化数据
 * - 批量导入（数组形式）
 *
 * 未来可扩展：
 * - 图片：OCR 提取文本 → 走文字 Pipeline
 * - 语音：Whisper API 转写 → 走文字 Pipeline
 * - PDF：pdf-parse 提取文本 → chunking → 批量导入
 */
export class MultimodalService {
  /**
   * 导入文本内容为记忆
   *
   * 自动 chunking 后逐块嵌入并存储
   */
  async importText(
    userId: string,
    workspaceId: string,
    text: string,
    source: string = 'manual_import',
    category: string = 'semantic'
  ): Promise<ImportResult> {
    const chunks = chunkingService.chunkText(text);
    const errors: string[] = [];
    let memoriesCreated = 0;

    for (const chunk of chunks) {
      try {
        const vector = await embeddingService.generateEmbedding(chunk);
        await milvusService.insertMemory(
          userId, workspaceId, chunk, vector,
          'general', 0, 5, 0, category
        );
        memoriesCreated++;
      } catch (err) {
        errors.push(`Chunk failed: ${(err as Error).message}`);
      }
    }

    console.log(`[Multimodal] 导入完成: ${memoriesCreated}/${chunks.length} chunks, source=${source}`);
    return { totalChunks: chunks.length, memoriesCreated, errors };
  }

  /**
   * 批量导入结构化记忆
   */
  async importBatch(
    userId: string,
    workspaceId: string,
    items: Array<{ content: string; category?: string; importance?: number }>
  ): Promise<ImportResult> {
    const errors: string[] = [];
    let memoriesCreated = 0;

    for (const item of items) {
      try {
        const vector = await embeddingService.generateEmbedding(item.content);
        await milvusService.insertMemory(
          userId, workspaceId, item.content, vector,
          'general', 0, item.importance || 5, 0, item.category || 'semantic'
        );
        memoriesCreated++;
      } catch (err) {
        errors.push(`Item failed: ${(err as Error).message}`);
      }
    }

    console.log(`[Multimodal] 批量导入完成: ${memoriesCreated}/${items.length} items`);
    return { totalChunks: items.length, memoriesCreated, errors };
  }

  /**
   * 导入 Markdown 文件
   *
   * 按标题分段后导入
   */
  async importMarkdown(
    userId: string,
    workspaceId: string,
    markdown: string,
    source: string = 'markdown_import'
  ): Promise<ImportResult> {
    const sections = this.splitMarkdownSections(markdown);
    const errors: string[] = [];
    let memoriesCreated = 0;

    for (const section of sections) {
      if (section.trim().length < 10) continue;
      try {
        const vector = await embeddingService.generateEmbedding(section);
        await milvusService.insertMemory(
          userId, workspaceId, section, vector,
          'general', 0, 5, 0, 'semantic'
        );
        memoriesCreated++;
      } catch (err) {
        errors.push(`Section failed: ${(err as Error).message}`);
      }
    }

    console.log(`[Multimodal] Markdown 导入完成: ${memoriesCreated}/${sections.length} sections, source=${source}`);
    return { totalChunks: sections.length, memoriesCreated, errors };
  }

  /**
   * 导入 JSON 文件（数组格式）
   */
  async importJSON(
    userId: string,
    workspaceId: string,
    jsonString: string,
    source: string = 'json_import'
  ): Promise<ImportResult> {
    try {
      const data = JSON.parse(jsonString);

      if (Array.isArray(data)) {
        const items = data.map(item => {
          if (typeof item === 'string') return { content: item };
          return { content: item.content || JSON.stringify(item), category: item.category, importance: item.importance };
        });
        return this.importBatch(userId, workspaceId, items);
      }

      // Single object
      const content = data.content || JSON.stringify(data);
      return this.importText(userId, workspaceId, content, source);
    } catch (err) {
      return { totalChunks: 0, memoriesCreated: 0, errors: [`JSON parse error: ${(err as Error).message}`] };
    }
  }

  private splitMarkdownSections(markdown: string): string[] {
    const sections: string[] = [];
    const lines = markdown.split('\n');
    let currentSection = '';

    for (const line of lines) {
      if (/^#{1,3}\s/.test(line) && currentSection.trim()) {
        sections.push(currentSection.trim());
        currentSection = line + '\n';
      } else {
        currentSection += line + '\n';
      }
    }

    if (currentSection.trim()) {
      sections.push(currentSection.trim());
    }

    return sections;
  }
}

export const multimodalService = new MultimodalService();
