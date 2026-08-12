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

export function composeEntityText(title: string, description = '') {
  const normalizedTitle = title.replace(/\r\n/g, '\n').trimEnd() || '未命名内容';
  const normalizedDescription = description.replace(/\r\n/g, '\n').trimEnd();
  return normalizedDescription
    ? `${normalizedTitle}\n${normalizedDescription}`
    : normalizedTitle;
}
