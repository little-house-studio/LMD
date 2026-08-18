export function splitEntityText(label: string) {
  const normalized = label.replace(/\r\n/g, '\n').trimEnd();
  if (!normalized) {
    return { title: '', description: '' };
  }
  const [titleLine, ...restLines] = normalized.split('\n');
  return {
    title: titleLine.trim(),
    description: restLines.join('\n').trim(),
  };
}

export function isPlaceholderTitle(title: string) {
  const value = title.trim();
  return value === '' || value === '新建节点' || value === '未命名内容';
}

export function estimateEdgeLabelSize(text: string): { width: number; height: number } {
  const trimmed = text.trim();
  if (!trimmed) {
    return { width: 0, height: 0 };
  }
  let width = 0;
  for (const char of trimmed) {
    width += char.charCodeAt(0) > 255 ? 11 : 6.5;
  }
  return {
    width: Math.ceil(width + 18),
    height: 24,
  };
}

export function composeEntityText(title: string, description = '') {
  const normalizedTitle = title.replace(/\r\n/g, '\n').trimEnd() || '未命名内容';
  const normalizedDescription = description.replace(/\r\n/g, '\n').trimEnd();
  return normalizedDescription
    ? `${normalizedTitle}\n${normalizedDescription}`
    : normalizedTitle;
}
