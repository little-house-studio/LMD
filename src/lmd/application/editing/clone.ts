import type { GraphDocument } from '@lths/lmd/legacy';
import type { MindNodeIR } from '@lths/lmd/legacy';

function cloneMindNode(node: MindNodeIR): MindNodeIR {
  return {
    ...node,
    children: node.children.map((child) => cloneMindNode(child)),
  };
}

/** Shallow-structural clone of the canvas working document (no React / engine). */
export function cloneWorkingDocument(doc: GraphDocument): GraphDocument {
  return {
    ...doc,
    nodes: doc.nodes.map((n) => ({ ...n })),
    edges: doc.edges.map((e) => ({ ...e })),
    subgraphs: doc.subgraphs.map((s) => ({ ...s })),
    sequence: doc.sequence
      ? {
          scenes: doc.sequence.scenes.map((scene) => ({
            ...scene,
            participants: scene.participants.map((item) => ({ ...item })),
            steps: scene.steps.map((step) => (
              step.kind === 'message'
                ? { kind: 'message' as const, message: { ...step.message } }
                : { kind: 'fragment' as const, fragment: { ...step.fragment, steps: [...step.fragment.steps] } }
            )),
          })),
        }
      : undefined,
    mind: doc.mind
      ? {
          maps: doc.mind.maps.map((map) => ({
            ...map,
            children: map.children.map((node) => cloneMindNode(node)),
          })),
        }
      : undefined,
    unsupportedLines: [...doc.unsupportedLines],
    warnings: [...doc.warnings],
    layout: {
      ...doc.layout,
      viewport: { ...doc.layout.viewport },
      nodes: { ...doc.layout.nodes },
      subgraphs: { ...doc.layout.subgraphs },
    },
    compat: doc.compat
      ? {
          ...doc.compat,
          extras: doc.compat.extras ? { ...doc.compat.extras } : undefined,
        }
      : undefined,
  };
}
