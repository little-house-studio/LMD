import type { MindPaintModel, MindPaintNode } from '../../placement/mind';
import { MIND_HEADER } from '../../placement/mind';

type PaintOptions = {
  selected: boolean;
  selectedTopicId?: string | null;
  screenPx: (value: number) => number;
};

export function paintMindBlock(
  ctx: CanvasRenderingContext2D,
  model: MindPaintModel,
  options: PaintOptions,
) {
  const { frame, title, addTopic, root, nodes, links } = model;
  const { selected, selectedTopicId, screenPx } = options;
  ctx.save();

  ctx.fillStyle = 'rgba(8, 18, 20, 0.92)';
  ctx.strokeStyle = selected ? '#2f80ff' : '#2dd4bf';
  ctx.lineWidth = screenPx(selected ? 2 : 1.4);
  roundRect(ctx, frame.x, frame.y, frame.width, frame.height, 10);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = 'rgba(45, 212, 191, 0.12)';
  ctx.fillRect(frame.x, frame.y, frame.width, MIND_HEADER);
  ctx.fillStyle = '#ccfbf1';
  ctx.font = `700 ${screenPx(12)}px "Segoe UI", system-ui, sans-serif`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(`导图 · ${title}`, frame.x + 12, frame.y + MIND_HEADER / 2);

  ctx.strokeStyle = selected ? '#2f80ff' : '#2dd4bf';
  ctx.lineWidth = screenPx(1.2);
  roundRect(ctx, addTopic.x, addTopic.y, addTopic.width, addTopic.height, 6);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(addTopic.x + 6, addTopic.y + addTopic.height / 2);
  ctx.lineTo(addTopic.x + addTopic.width - 6, addTopic.y + addTopic.height / 2);
  ctx.moveTo(addTopic.x + addTopic.width / 2, addTopic.y + 6);
  ctx.lineTo(addTopic.x + addTopic.width / 2, addTopic.y + addTopic.height - 6);
  ctx.stroke();

  ctx.strokeStyle = 'rgba(94, 234, 212, 0.7)';
  ctx.lineWidth = screenPx(1.3);
  ctx.lineCap = 'round';
  for (const link of links) {
    const midX = (link.start.x + link.end.x) / 2;
    ctx.beginPath();
    ctx.moveTo(link.start.x, link.start.y);
    ctx.bezierCurveTo(midX, link.start.y, midX, link.end.y, link.end.x, link.end.y);
    ctx.stroke();
  }

  paintTopic(ctx, root, root.id === selectedTopicId, screenPx, true);
  for (const node of nodes) {
    paintTopic(ctx, node, node.id === selectedTopicId, screenPx, false);
  }

  ctx.restore();
}

function paintTopic(
  ctx: CanvasRenderingContext2D,
  node: MindPaintNode,
  active: boolean,
  screenPx: (value: number) => number,
  root: boolean,
) {
  ctx.fillStyle = active ? 'rgba(47, 128, 255, 0.22)' : root ? 'rgba(45, 212, 191, 0.18)' : 'rgba(20, 40, 42, 0.95)';
  ctx.strokeStyle = active ? '#2f80ff' : root ? '#5eead4' : '#2dd4bf';
  ctx.lineWidth = screenPx(active ? 1.8 : 1.15);
  roundRect(ctx, node.box.x, node.box.y, node.box.width, node.box.height, 7);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = active ? '#e8f1ff' : '#ecfeff';
  ctx.font = `${root ? 700 : 600} ${screenPx(11)}px "Segoe UI", system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const label = node.comment ? `${node.title} · ${node.comment}` : node.title;
  ctx.fillText(label, node.box.x + node.box.width / 2, node.box.y + node.box.height / 2, node.box.width - 10);
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}
