import type { EdgeKind, NodeShape } from '../../shared-kernel/kinds';
import type { LmdDocument } from '../../document/domain/document';
import type { Diagnostic } from '../../diagnostics/domain/diagnostic';

export type CommandCategory = 'project' | 'node' | 'edge' | 'group' | 'doc' | 'layout' | 'runtime';

export type LmdCommand =
  | { op: 'project.update'; name?: string; summary?: string; content?: string }
  | {
      op: 'node.create';
      title?: string;
      label?: string;
      x?: number;
      y?: number;
      groupId?: string | null;
    }
  | {
      op: 'node.update';
      id: string;
      title?: string;
      label?: string;
      shape?: NodeShape;
      fill?: string;
      stroke?: string;
      textColor?: string;
    }
  | { op: 'node.delete'; ids: string[] }
  | { op: 'node.duplicate'; ids: string[] }
  | { op: 'edge.create'; from: string; to: string; label?: string; kind?: EdgeKind }
  | {
      op: 'edge.update';
      id: string;
      label?: string;
      kind?: EdgeKind;
      strokeColor?: string;
      strokeWidth?: number;
    }
  | { op: 'edge.delete'; ids: string[] }
  | { op: 'edge.insertNode'; edgeId: string; nodeId: string }
  | { op: 'group.create'; title?: string; nodeIds: string[] }
  | {
      op: 'group.update';
      id: string;
      title?: string;
      fill?: string;
      stroke?: string;
      textColor?: string;
    }
  | { op: 'group.dissolve'; ids: string[] }
  | { op: 'doc.check' }
  | { op: 'doc.standardize' }
  | { op: 'doc.fix'; mode?: 'safe' | 'suggest' }
  | { op: 'layout.auto' }
  | { op: 'layout.tidy' };

export type CommandOp = LmdCommand['op'];

export interface CommandSpec {
  op: CommandOp;
  title: string;
  category: CommandCategory;
  mutates: boolean;
}

export interface CommandResult {
  document: LmdDocument;
  diagnostics: Diagnostic[];
  inverse?: LmdCommand;
  createdIds?: string[];
}

export interface CommandContext {
  layout?: {
    auto?: (document: LmdDocument) => LmdDocument;
    tidy?: (document: LmdDocument) => LmdDocument;
  };
}
