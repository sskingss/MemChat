/**
 * 时间上下文工具
 *
 * 提供丰富的时间信息，帮助 LLM 准确理解和处理时间相关的记忆
 */

export interface TimeContext {
  /** ISO 格式的当前时间 */
  currentDateTime: string;
  /** 当前日期 YYYY-MM-DD */
  currentDate: string;
  /** 当前日期中文 YYYY年M月D日 */
  currentDateCN: string;
  /** 星期几 (中文) */
  dayOfWeekCN: string;
  /** 当前时间 HH:mm */
  currentTime: string;
  /** 明天的日期 */
  tomorrow: string;
  /** 明天星期几 */
  tomorrowDayOfWeekCN: string;
  /** 后天的日期 */
  dayAfterTomorrow: string;
  /** 后天星期几 */
  dayAfterTomorrowDayOfWeekCN: string;
  /** 下周一 */
  nextMonday: string;
  /** 本周结束日期 (周日) */
  thisWeekEnd: string;
  /** 下周结束日期 (周日) */
  nextWeekEnd: string;
  /** 格式化的完整时间上下文 */
  formattedContext: string;
}

/**
 * 获取丰富的时间上下文
 */
export function getRichTimeContext(): TimeContext {
  const now = new Date();

  // 基础时间
  const currentDateTime = now.toISOString();
  const currentDate = formatDate(now);
  const currentDateCN = formatDateCN(now);
  const dayOfWeekCN = getDayOfWeekCN(now);
  const currentTime = formatTime(now);

  // 明天
  const tomorrowDate = addDays(now, 1);
  const tomorrow = formatDate(tomorrowDate);
  const tomorrowDayOfWeekCN = getDayOfWeekCN(tomorrowDate);

  // 后天
  const dayAfterTomorrowDate = addDays(now, 2);
  const dayAfterTomorrow = formatDate(dayAfterTomorrowDate);
  const dayAfterTomorrowDayOfWeekCN = getDayOfWeekCN(dayAfterTomorrowDate);

  // 下周一
  const nextMondayDate = getNextMonday(now);
  const nextMonday = formatDate(nextMondayDate);

  // 本周结束 (周日)
  const thisWeekEndDate = getEndOfWeek(now);
  const thisWeekEnd = formatDate(thisWeekEndDate);

  // 下周结束
  const nextWeekEndDate = addDays(thisWeekEndDate, 7);
  const nextWeekEnd = formatDate(nextWeekEndDate);

  // 格式化完整上下文
  const formattedContext = `当前时间: ${currentDateCN} ${dayOfWeekCN} ${currentTime}
今天: ${currentDate} (${dayOfWeekCN})
明天: ${tomorrow} (${tomorrowDayOfWeekCN})
后天: ${dayAfterTomorrow} (${dayAfterTomorrowDayOfWeekCN})
下周一: ${nextMonday}
本周结束: ${thisWeekEnd} (周日)
下周结束: ${nextWeekEnd} (周日)`;

  return {
    currentDateTime,
    currentDate,
    currentDateCN,
    dayOfWeekCN,
    currentTime,
    tomorrow,
    tomorrowDayOfWeekCN,
    dayAfterTomorrow,
    dayAfterTomorrowDayOfWeekCN,
    nextMonday,
    thisWeekEnd,
    nextWeekEnd,
    formattedContext,
  };
}

/**
 * 格式化日期为 YYYY-MM-DD
 */
export function formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * 格式化日期为中文 YYYY年M月D日
 */
export function formatDateCN(date: Date): string {
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  const day = date.getDate();
  return `${year}年${month}月${day}日`;
}

/**
 * 格式化时间为 HH:mm
 */
export function formatTime(date: Date): string {
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}

/**
 * 获取星期几 (中文)
 */
export function getDayOfWeekCN(date: Date): string {
  const days = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  return days[date.getDay()];
}

/**
 * 添加天数
 */
export function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

/**
 * 获取下一个周一
 */
export function getNextMonday(date: Date): Date {
  const result = new Date(date);
  const dayOfWeek = result.getDay();
  const daysUntilMonday = dayOfWeek === 0 ? 1 : 8 - dayOfWeek;
  result.setDate(result.getDate() + daysUntilMonday);
  return result;
}

/**
 * 获取本周结束日期 (周日)
 */
export function getEndOfWeek(date: Date): Date {
  const result = new Date(date);
  const dayOfWeek = result.getDay();
  const daysUntilEnd = dayOfWeek === 0 ? 0 : 7 - dayOfWeek;
  result.setDate(result.getDate() + daysUntilEnd);
  return result;
}

/**
 * 格式化时间戳为可读格式
 */
export function formatTimestamp(timestamp: number): string {
  const date = new Date(timestamp);
  return `${formatDateCN(date)} ${formatTime(date)}`;
}

/**
 * 格式化时间戳为简短格式 (仅日期)
 */
export function formatTimestampShort(timestamp: number): string {
  const date = new Date(timestamp);
  return `${formatDate(date)} (${getDayOfWeekCN(date)})`;
}
