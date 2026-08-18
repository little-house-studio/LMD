export type GroupChrome = {
  fill: string;
  stroke: string;
  text: string;
  lineWidth: number;
  radius: number;
};

const DEPTH_CHROME: GroupChrome[] = [
  { fill: 'rgba(24, 78, 86, 0.20)', stroke: '#4aa8b4', text: '#c5eef2', lineWidth: 1.7, radius: 12 },
  { fill: 'rgba(14, 52, 60, 0.32)', stroke: '#6ee0ea', text: '#e7fbff', lineWidth: 1.35, radius: 9 },
  { fill: 'rgba(10, 40, 48, 0.38)', stroke: '#9ad4dc', text: '#f4f4f5', lineWidth: 1.2, radius: 8 },
];

export function groupChrome(
  depth: number,
  selected: boolean,
  custom?: { fill?: string; stroke?: string; textColor?: string },
): GroupChrome {
  const palette = DEPTH_CHROME[Math.min(Math.max(depth, 0), DEPTH_CHROME.length - 1)] ?? DEPTH_CHROME[0];
  return {
    fill: custom?.fill && custom.fill !== '#141418' ? custom.fill : palette.fill,
    stroke: selected ? '#d6ff3a' : custom?.stroke && custom.stroke !== '#00f0ff' ? custom.stroke : palette.stroke,
    text: custom?.textColor && custom.textColor !== '#f4f4f5' ? custom.textColor : palette.text,
    lineWidth: selected ? 2 : palette.lineWidth,
    radius: palette.radius,
  };
}
