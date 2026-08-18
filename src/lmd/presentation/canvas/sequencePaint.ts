import type { SequencePaintActivation, SequencePaintColumn, SequencePaintModel } from '../../placement/sequence';
import { SEQ_HEADER } from '../../placement/sequence';

type PaintOptions = {
  selected: boolean;
  selectedActorId?: string | null;
  selectedMessageId?: string | null;
  screenPx: (value: number) => number;
};

export function paintSequenceBlock(
  ctx: CanvasRenderingContext2D,
  model: SequencePaintModel,
  options: PaintOptions,
) {
  const { frame, title, columns, messages, fragments, addActor, activations } = model;
  const { selected, selectedActorId, selectedMessageId, screenPx } = options;
  ctx.save();

  ctx.fillStyle = 'rgba(16, 12, 22, 0.92)';
  ctx.strokeStyle = selected ? '#2f80ff' : '#c77dff';
  ctx.lineWidth = screenPx(selected ? 2 : 1.4);
  roundRect(ctx, frame.x, frame.y, frame.width, frame.height, 10);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = 'rgba(199, 125, 255, 0.12)';
  ctx.fillRect(frame.x, frame.y, frame.width, SEQ_HEADER);
  ctx.fillStyle = '#f3e8ff';
  ctx.font = `700 ${screenPx(12)}px "Segoe UI", system-ui, sans-serif`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(`时序 · ${title}`, frame.x + 12, frame.y + SEQ_HEADER / 2);

  ctx.strokeStyle = selected ? '#2f80ff' : '#c77dff';
  ctx.lineWidth = screenPx(1.2);
  roundRect(ctx, addActor.x, addActor.y, addActor.width, addActor.height, 6);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(addActor.x + 6, addActor.y + addActor.height / 2);
  ctx.lineTo(addActor.x + addActor.width - 6, addActor.y + addActor.height / 2);
  ctx.moveTo(addActor.x + addActor.width / 2, addActor.y + 6);
  ctx.lineTo(addActor.x + addActor.width / 2, addActor.y + addActor.height - 6);
  ctx.stroke();

  ctx.strokeStyle = '#7c6a9a';
  ctx.lineWidth = screenPx(1.15);
  ctx.setLineDash([]);
  for (const column of columns) {
    ctx.beginPath();
    ctx.moveTo(column.x, column.chip.y + column.chip.height);
    ctx.lineTo(column.x, column.bottomChip.y);
    ctx.stroke();
  }

  for (const bar of activations) {
    ctx.fillStyle = 'rgba(167, 139, 250, 0.38)';
    ctx.strokeStyle = '#a78bfa';
    ctx.lineWidth = screenPx(1);
    roundRect(ctx, bar.x, bar.y, bar.width, bar.height, 2);
    ctx.fill();
    ctx.stroke();
  }

  ctx.strokeStyle = 'rgba(199, 125, 255, 0.7)';
  ctx.fillStyle = 'rgba(199, 125, 255, 0.06)';
  ctx.setLineDash([5, 4]);
  ctx.font = `600 ${screenPx(11)}px "Segoe UI", system-ui, sans-serif`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  for (const box of fragments) {
    roundRect(ctx, box.x, box.y, box.width, box.height, 6);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#e9d5ff';
    ctx.fillText(box.label, box.x + 8, box.y + 14);
    ctx.fillStyle = 'rgba(199, 125, 255, 0.06)';
  }
  ctx.setLineDash([]);

  ctx.font = `600 ${screenPx(12)}px "Segoe UI", system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const column of columns) {
    paintActorChip(ctx, column, column.id === selectedActorId, screenPx);
  }

  ctx.font = `${screenPx(11)}px ui-monospace, SF Mono, Consolas, monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  for (const message of messages) {
    const call = message.arrow === 'call';
    const active = message.id === selectedMessageId;
    const color = active ? '#2f80ff' : call ? '#d6ff3a' : '#00f0ff';
    ctx.strokeStyle = color;
    ctx.fillStyle = '#e4e4e7';
    ctx.lineWidth = screenPx(active ? 2.4 : 1.5);
    ctx.setLineDash(call ? [] : [6, 5]);
    ctx.beginPath();
    if (message.self) {
      ctx.moveTo(message.fromX, message.y - 8);
      ctx.bezierCurveTo(message.fromX + 36, message.y - 8, message.fromX + 36, message.y + 8, message.fromX, message.y + 8);
      ctx.stroke();
      drawArrowHead(ctx, message.fromX, message.y + 8, Math.PI, color);
      ctx.fillText(message.label, message.fromX + 40, message.y - 10);
    } else {
      const dir = message.toX >= message.fromX ? 1 : -1;
      const endX = message.toX - dir * 6;
      ctx.moveTo(message.fromX, message.y);
      ctx.lineTo(endX, message.y);
      ctx.stroke();
      drawArrowHead(ctx, endX, message.y, dir > 0 ? 0 : Math.PI, color);
      ctx.fillText(message.label, (message.fromX + message.toX) / 2, message.y - 6);
    }
    ctx.setLineDash([]);
  }

  ctx.restore();
}

function paintActorChip(
  ctx: CanvasRenderingContext2D,
  column: SequencePaintColumn,
  active: boolean,
  screenPx: (value: number) => number,
) {
  for (const chip of [column.chip, column.bottomChip]) {
    ctx.fillStyle = '#1a1524';
    ctx.strokeStyle = active ? '#2f80ff' : '#c4b5fd';
    ctx.lineWidth = screenPx(active ? 2 : 1.15);
    roundRect(ctx, chip.x, chip.y, chip.width, chip.height, 6);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#f4f4f5';
    ctx.fillText(column.title, column.x, chip.y + chip.height / 2);
  }
}

export function paintSequenceActivationHighlight(
  ctx: CanvasRenderingContext2D,
  bar: SequencePaintActivation,
  screenPx: (value: number) => number,
) {
  ctx.save();
  ctx.fillStyle = 'rgba(47, 128, 255, 0.28)';
  ctx.strokeStyle = '#2f80ff';
  ctx.lineWidth = screenPx(2);
  roundRect(ctx, bar.x, bar.y, bar.width, bar.height, 2);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

export function paintSequenceConnectPreview(
  ctx: CanvasRenderingContext2D,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  screenPx: (value: number) => number,
  options?: { snapped?: boolean; arrow?: 'call' | 'return' },
) {
  const snapped = options?.snapped ?? false;
  const returning = options?.arrow === 'return';
  ctx.save();
  ctx.strokeStyle = returning ? '#00f0ff' : '#2f80ff';
  ctx.lineWidth = screenPx(snapped ? 2 : 1.6);
  ctx.setLineDash(snapped ? [] : [screenPx(6), screenPx(4)]);
  ctx.beginPath();
  ctx.moveTo(fromX, fromY);
  ctx.lineTo(toX, toY);
  ctx.stroke();
  if (snapped && Math.hypot(toX - fromX, toY - fromY) > 4) {
    const heading = Math.atan2(toY - fromY, toX - fromX);
    drawArrowHead(ctx, toX, toY, heading, returning ? '#00f0ff' : '#2f80ff');
  }
  ctx.restore();
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

function drawArrowHead(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  heading: number,
  color: string,
) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(heading);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(-8, -4);
  ctx.lineTo(-8, 4);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}
