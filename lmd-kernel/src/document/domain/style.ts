export interface ColorStyle {
  fill: string;
  stroke: string;
  textColor: string;
}

export interface EdgeStyle {
  strokeColor: string;
  strokeWidth: number;
}

export interface StyleIR {
  nodes: Record<string, ColorStyle>;
  groups: Record<string, ColorStyle>;
  edges: Record<string, EdgeStyle>;
}

export function emptyStyle(): StyleIR {
  return { nodes: {}, groups: {}, edges: {} };
}
