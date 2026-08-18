export interface EngineRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SceneIndexEntry<T> {
  id: string;
  rect: EngineRect;
  item: T;
}

function rectIntersects(left: EngineRect, right: EngineRect) {
  return (
    left.x <= right.x + right.width &&
    left.x + left.width >= right.x &&
    left.y <= right.y + right.height &&
    left.y + left.height >= right.y
  );
}

function pointInRect(x: number, y: number, rect: EngineRect, padding = 0) {
  return (
    x >= rect.x - padding &&
    x <= rect.x + rect.width + padding &&
    y >= rect.y - padding &&
    y <= rect.y + rect.height + padding
  );
}

function bucketKey(x: number, y: number) {
  return `${x}:${y}`;
}

export class SceneSpatialIndex<T> {
  private readonly buckets = new Map<string, SceneIndexEntry<T>[]>();
  private readonly entries = new Map<string, SceneIndexEntry<T>>();

  constructor(
    entries: SceneIndexEntry<T>[] = [],
    private readonly bucketSize = 256,
  ) {
    entries.forEach((entry) => this.insert(entry));
  }

  insert(entry: SceneIndexEntry<T>) {
    this.entries.set(entry.id, entry);
    const minBucketX = Math.floor(entry.rect.x / this.bucketSize);
    const minBucketY = Math.floor(entry.rect.y / this.bucketSize);
    const maxBucketX = Math.floor((entry.rect.x + entry.rect.width) / this.bucketSize);
    const maxBucketY = Math.floor((entry.rect.y + entry.rect.height) / this.bucketSize);

    for (let bucketY = minBucketY; bucketY <= maxBucketY; bucketY += 1) {
      for (let bucketX = minBucketX; bucketX <= maxBucketX; bucketX += 1) {
        const key = bucketKey(bucketX, bucketY);
        const bucket = this.buckets.get(key);
        if (bucket) {
          bucket.push(entry);
        } else {
          this.buckets.set(key, [entry]);
        }
      }
    }
  }

  get(id: string) {
    return this.entries.get(id) ?? null;
  }

  queryRect(rect: EngineRect) {
    const result = new Map<string, SceneIndexEntry<T>>();
    const minBucketX = Math.floor(rect.x / this.bucketSize);
    const minBucketY = Math.floor(rect.y / this.bucketSize);
    const maxBucketX = Math.floor((rect.x + rect.width) / this.bucketSize);
    const maxBucketY = Math.floor((rect.y + rect.height) / this.bucketSize);

    for (let bucketY = minBucketY; bucketY <= maxBucketY; bucketY += 1) {
      for (let bucketX = minBucketX; bucketX <= maxBucketX; bucketX += 1) {
        const bucket = this.buckets.get(bucketKey(bucketX, bucketY));
        if (!bucket) {
          continue;
        }
        for (const entry of bucket) {
          if (rectIntersects(entry.rect, rect)) {
            result.set(entry.id, entry);
          }
        }
      }
    }

    return [...result.values()];
  }

  queryPoint(point: { x: number; y: number }, padding = 0) {
    const rect = {
      x: point.x - padding,
      y: point.y - padding,
      width: padding * 2,
      height: padding * 2,
    };

    return this.queryRect(rect).filter((entry) => pointInRect(point.x, point.y, entry.rect, padding));
  }
}

interface TextTexture {
  canvas: HTMLCanvasElement | OffscreenCanvas;
  width: number;
  height: number;
  lastUsed: number;
}

/** Screen-space label. Avoids allocating a texture per zoom step. */
export function fillCenteredLine(
  context: CanvasRenderingContext2D,
  text: string,
  centerX: number,
  centerY: number,
  font: string,
  fill: string,
  maxWidth?: number,
) {
  context.font = font;
  context.fillStyle = fill;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  if (maxWidth !== undefined && maxWidth > 0) {
    context.fillText(text || ' ', centerX, centerY, maxWidth);
    return;
  }
  context.fillText(text || ' ', centerX, centerY);
}

export class CanvasTextCache {
  private readonly cache = new Map<string, TextTexture>();
  private tick = 0;

  constructor(private readonly maxEntries = 1800) {}

  drawCenteredLine(
    context: CanvasRenderingContext2D,
    text: string,
    centerX: number,
    centerY: number,
    font: string,
    fill: string,
    maxWidth?: number,
  ) {
    const normalizedText = text || ' ';
    const key = `${font}::${fill}::${normalizedText}`;
    let texture = this.cache.get(key);

    if (!texture) {
      texture = this.buildTexture(normalizedText, font, fill);
      this.cache.set(key, texture);
      this.prune();
    }

    texture.lastUsed = ++this.tick;
    const width = maxWidth && texture.width > maxWidth ? maxWidth : texture.width;
    const height = width === texture.width ? texture.height : texture.height * (width / texture.width);
    context.drawImage(
      texture.canvas,
      centerX - width / 2,
      centerY - height / 2,
      width,
      height,
    );
  }

  private buildTexture(text: string, font: string, fill: string): TextTexture {
    const measureCanvas = document.createElement('canvas');
    const measureContext = measureCanvas.getContext('2d');
    if (!measureContext) {
      return { canvas: measureCanvas, width: 1, height: 1, lastUsed: this.tick };
    }

    measureContext.font = font;
    const metrics = measureContext.measureText(text);
    const width = Math.max(1, Math.ceil(metrics.width + 8));
    const height = Math.max(1, Math.ceil(
      (metrics.actualBoundingBoxAscent || 12) +
      (metrics.actualBoundingBoxDescent || 4) +
      8,
    ));
    const canvas = typeof OffscreenCanvas !== 'undefined'
      ? new OffscreenCanvas(width, height)
      : document.createElement('canvas');

    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
    if (!context) {
      return { canvas, width, height, lastUsed: this.tick };
    }

    context.imageSmoothingEnabled = false;
    context.font = font;
    context.fillStyle = fill;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(text, width / 2, height / 2);
    return { canvas, width, height, lastUsed: this.tick };
  }

  private prune() {
    if (this.cache.size <= this.maxEntries) {
      return;
    }

    const stale = [...this.cache.entries()]
      .sort((left, right) => left[1].lastUsed - right[1].lastUsed)
      .slice(0, Math.ceil(this.maxEntries * 0.18));
    stale.forEach(([key]) => this.cache.delete(key));
  }
}
