import { buildEntityIdFromTitle } from '../../../shared-kernel/identity';
import { LMD_PROTOCOL } from '../../../shared-kernel/protocol';
import { emptyExec } from '../../../document/domain/exec';
import { emptyLayout } from '../../../document/domain/layout';
import { emptyStyle } from '../../../document/domain/style';
import type { EdgeIR, GroupIR, NodeIR, TodoIR } from '../../../document/domain/graph';
import type { LmdDocument } from '../../../document/domain/document';
import { EMPTY_MERMAID } from '../../../document/domain/document';
import type {
  SequenceFragmentIR,
  SequenceFragmentType,
  SequenceMessageIR,
  SequenceParticipantIR,
  SequenceSceneIR,
  SequenceStepIR,
} from '../../../document/domain/sequence';
import type { MindMapIR, MindNodeIR } from '../../../document/domain/mind';
import { lexLmdLang, type Token } from './lex';

type AttrMap = {
  comment?: string;
  todo?: TodoIR;
  url?: string;
  members?: Value[];
  extra: { name: string; value: Value }[];
};

type Value =
  | { kind: 'string'; value: string }
  | { kind: 'list'; items: Value[] }
  | { kind: 'call'; name: string; arg: Value | null; attrs: AttrMap };

const KNOWN_HEADINGS = new Set(['关系', 'graph', '笔记', 'notes', 'content', '内容', '时序', 'sequence', 'seq', '思维导图', 'mind', 'mindmap']);
const SEQ_FRAGMENTS = new Set(['alt', 'opt', 'loop', 'par']);

export function parseLmdLang(text: string, fallbackName = 'Untitled Project'): LmdDocument {
  const source = text.replace(/^\uFEFF/, '');
  const tokens = lexLmdLang(source);
  const parser = new Parser(source, tokens, fallbackName);
  return parser.parse();
}

class Parser {
  private i = 0;
  private projectName: string;
  private summary = '';
  private content = '';
  private unsupported: string[] = [];
  private nodes = new Map<string, NodeIR>();
  private groups = new Map<string, GroupIR>();
  private titleToNodeId = new Map<string, string>();
  private titleToGroupId = new Map<string, string>();
  private titleToSceneId = new Map<string, string>();
  private titleToMindId = new Map<string, string>();
  private edges: EdgeIR[] = [];
  private usedIds = new Set<string>();
  private scenes: SequenceSceneIR[] = [];
  private maps: MindMapIR[] = [];
  private implicitScene: SequenceSceneIR | null = null;
  private section: 'graph' | 'sequence' | 'mind' = 'graph';
  private seqMessageSalt = 0;

  constructor(
    private readonly source: string,
    private readonly tokens: Token[],
    fallbackName: string,
  ) {
    this.projectName = fallbackName;
  }

  parse(): LmdDocument {
    while (!this.eof()) {
      this.skipNewlines();
      if (this.eof()) {
        break;
      }
      const token = this.peek();
      if (token.kind === 'heading') {
        this.readHeading();
        continue;
      }
      this.readStatement();
    }

    this.relinkSequenceEndpoints();
    this.relinkMindEndpoints();

    return {
      protocol: { ...LMD_PROTOCOL },
      project: {
        name: this.projectName.trim() || 'Untitled Project',
        summary: this.summary,
        content: this.content,
      },
      graph: {
        direction: 'LR',
        nodes: [...this.nodes.values()],
        edges: this.edges,
        groups: [...this.groups.values()],
      },
      sequence: {
        scenes: this.scenes.map((scene) => ({
          ...scene,
          participants: this.collectSceneParticipants(scene),
        })),
      },
      mind: {
        maps: this.maps,
      },
      style: emptyStyle(),
      layout: emptyLayout(),
      display: {
        lmdSource: this.source,
        mermaidSource: EMPTY_MERMAID,
        diagramType: 'flowchart',
        direction: 'LR',
      },
      plugins: [],
      exec: emptyExec(),
      extras: { unsupportedLines: this.unsupported },
    };
  }

  private readHeading() {
    const token = this.next();
    const key = token.value.trim().toLowerCase();
    if (key === '笔记' || key === 'notes' || key === 'content' || key === '内容') {
      this.content = this.source.slice(token.end).replace(/^\s*\n/, '').trimEnd();
      this.i = this.tokens.length - 1;
      return;
    }
    if (key === '时序' || key === 'sequence' || key === 'seq') {
      this.section = 'sequence';
      return;
    }
    if (key === '思维导图' || key === 'mind' || key === 'mindmap') {
      this.section = 'mind';
      return;
    }
    if (key === '关系' || key === 'graph') {
      this.section = 'graph';
      return;
    }
    if (!KNOWN_HEADINGS.has(key)) {
      this.unsupported.push(`# ${token.value}`);
    }
  }

  private readStatement() {
    const start = this.peek();
    if (start.kind === 'at') {
      const name = start.value.toLowerCase();
      if (name === 'project') {
        this.readProject();
        return;
      }
      if (name === 'node') {
        this.readNodeCall();
        return;
      }
      if (name === 'group' || name === 'groud') {
        this.ingestGroup(this.parseCall());
        return;
      }
      if (name === 'seq') {
        this.readSeq();
        return;
      }
      if (name === 'mind' || name === 'mindmap') {
        this.readMind();
        return;
      }
      if (SEQ_FRAGMENTS.has(name) && this.section === 'sequence') {
        this.defaultScene().steps.push(this.readSeqFragment());
        return;
      }
      if (name === 'subbranch') {
        this.readSubbranch();
        return;
      }
      if (name === 'backto') {
        this.keepUnsupported();
        return;
      }
      if (name.startsWith('ai') || name.startsWith('cli') || name === 'plugin' || name === 'lastnode' || name === 'nownode' || name === 'lasenode') {
        this.keepUnsupported();
        return;
      }
      this.keepUnsupported();
      return;
    }
    if (start.kind === 'string') {
      if (this.section === 'sequence' || this.isSeqArrow(this.peekAheadAfterString())) {
        this.readSeqMessageInto(this.defaultScene());
        return;
      }
      this.readChainOrNode();
      return;
    }
    if (start.kind === 'lbrack') {
      this.readChainOrNode();
      return;
    }
    this.keepUnsupported();
  }

  private readProject() {
    const call = this.parseCall();
    const name = firstString(call.arg) ?? this.projectName;
    this.projectName = name;
    if (call.attrs.comment) {
      this.summary = call.attrs.comment;
    }
  }

  private readSeq() {
    this.next();
    if (this.peek().kind === 'colon') {
      this.next();
    }
    let title = '';
    if (this.peek().kind === 'string') {
      title = this.next().value;
    }
    const scene = this.createScene(title);
    this.scenes.push(scene);
    if (this.peek().kind !== 'lparen') {
      return;
    }
    this.next();
    this.readSeqBody(scene);
    if (this.peek().kind === 'rparen') {
      this.next();
    }
    const attrs = this.peek().kind === 'lbrack' ? this.parseAttrs() : emptyAttrs();
    if (attrs.comment && !scene.title) {
      scene.title = attrs.comment;
    }
  }

  private readMind() {
    this.next();
    if (this.peek().kind === 'colon') {
      this.next();
    }
    let title = '';
    if (this.peek().kind === 'string') {
      title = this.next().value;
    }
    const map = this.createMindMap(title);
    this.maps.push(map);
    if (this.peek().kind !== 'lparen') {
      return;
    }
    this.next();
    this.readMindBody(map);
    if (this.peek().kind === 'rparen') {
      this.next();
    }
  }

  private createMindMap(title: string): MindMapIR {
    const resolved = title.trim() || '思维导图';
    const id = buildEntityIdFromTitle(resolved, this.usedIds);
    this.usedIds.add(id);
    this.titleToMindId.set(resolved, id);
    return { id, title: resolved, children: [] };
  }

  private lineIndent(index: number) {
    let cursor = index;
    while (cursor > 0 && this.source[cursor - 1] !== '\n') {
      cursor -= 1;
    }
    let spaces = 0;
    while (cursor < index && (this.source[cursor] === ' ' || this.source[cursor] === '\t')) {
      spaces += this.source[cursor] === '\t' ? 2 : 1;
      cursor += 1;
    }
    return spaces;
  }

  private isMindBullet(value: string) {
    return value === '-' || value === '*' || value === '+' || /^\d+\.$/.test(value);
  }

  private readMindBody(map: MindMapIR) {
    const items: Array<{ depth: number; node: MindNodeIR }> = [];
    while (!this.eof() && this.peek().kind !== 'rparen') {
      this.skipNewlines();
      if (this.peek().kind === 'rparen' || this.peek().kind === 'eof') {
        break;
      }
      if (this.peek().kind === 'comma') {
        this.next();
        continue;
      }
      const item = this.readMindItem();
      if (item) {
        items.push(item);
      }
    }
    map.children = this.buildMindTree(items);
  }

  private readMindItem(): { depth: number; node: MindNodeIR } | null {
    const token = this.peek();
    const depth = this.lineIndent(token.start);
    if (token.kind === 'string' && this.isMindBullet(token.value)) {
      this.next();
    }
    if (this.peek().kind !== 'string' && this.peek().kind !== 'at') {
      this.next();
      return null;
    }
    const title = this.expectString();
    if (!title) {
      return null;
    }
    let comment: string | undefined;
    if (this.peek().kind === 'lbrack') {
      comment = this.parseAttrs().comment;
    }
    const id = buildEntityIdFromTitle(title, this.usedIds);
    this.usedIds.add(id);
    return {
      depth,
      node: { id, title, comment, children: [] },
    };
  }

  private buildMindTree(items: Array<{ depth: number; node: MindNodeIR }>): MindNodeIR[] {
    const roots: MindNodeIR[] = [];
    const stack: Array<{ depth: number; node: MindNodeIR }> = [];
    const base = items[0]?.depth ?? 0;
    for (const item of items) {
      const depth = Math.max(0, Math.round((item.depth - base) / 2));
      while (stack.length > 0 && (stack[stack.length - 1]?.depth ?? 0) >= depth) {
        stack.pop();
      }
      const parent = stack[stack.length - 1];
      if (parent) {
        parent.node.children.push(item.node);
      } else {
        roots.push(item.node);
      }
      stack.push({ depth, node: item.node });
    }
    return roots;
  }

  private readSeqBody(scene: SequenceSceneIR) {
    while (!this.eof() && this.peek().kind !== 'rparen') {
      this.skipNewlines();
      if (this.peek().kind === 'rparen' || this.peek().kind === 'eof') {
        break;
      }
      if (this.peek().kind === 'comma') {
        this.next();
        continue;
      }
      this.readSeqStatement(scene);
    }
  }

  private readSeqStatement(scene: SequenceSceneIR) {
    const token = this.peek();
    if (token.kind === 'at') {
      const name = token.value.toLowerCase();
      if (SEQ_FRAGMENTS.has(name)) {
        scene.steps.push(this.readSeqFragment());
        return;
      }
      if (name === 'seq') {
        this.readSeq();
        return;
      }
      this.keepUnsupported();
      return;
    }
    if (token.kind === 'string') {
      this.readSeqMessageInto(scene);
      return;
    }
    this.keepUnsupported();
  }

  private readSeqFragment(): SequenceStepIR {
    const at = this.next();
    const type = (SEQ_FRAGMENTS.has(at.value.toLowerCase()) ? at.value.toLowerCase() : 'alt') as SequenceFragmentType;
    if (this.peek().kind === 'colon') {
      this.next();
    }
    let title = '';
    if (this.peek().kind === 'string') {
      title = this.next().value;
    }
    const fragment: SequenceFragmentIR = {
      id: this.nextSeqId(`frag_${type}`),
      type,
      title,
      steps: [],
    };
    if (this.peek().kind === 'lparen') {
      this.next();
      const box: SequenceSceneIR = {
        id: fragment.id,
        title: fragment.title,
        participants: [],
        steps: fragment.steps,
      };
      this.readSeqBody(box);
      if (this.peek().kind === 'rparen') {
        this.next();
      }
    }
    return { kind: 'fragment', fragment };
  }

  private readSeqMessageInto(scene: SequenceSceneIR) {
    const fromTitle = this.expectString();
    if (!this.isSeqArrow(this.peek())) {
      this.ensureParticipant(fromTitle);
      this.appendParticipant(scene, this.ensureParticipant(fromTitle));
      return;
    }
    const arrow = this.next().kind === 'arrowReturn' ? 'return' : 'call';
    const label = this.tryEdgeLabel();
    const toTitle = this.readEndpoint();
    const attrs = this.peek().kind === 'lbrack' ? this.parseAttrs() : emptyAttrs();
    const from = this.ensureParticipant(fromTitle);
    const to = this.ensureParticipant(toTitle);
    this.appendParticipant(scene, from);
    this.appendParticipant(scene, to);
    const message: SequenceMessageIR = {
      id: this.nextSeqId(`m_${from.id}_${to.id}`),
      from: from.id,
      to: to.id,
      label,
      arrow,
      comment: attrs.comment,
    };
    scene.steps.push({ kind: 'message', message });
  }

  private defaultScene(): SequenceSceneIR {
    if (!this.implicitScene) {
      this.implicitScene = this.createScene('时序');
      this.scenes.push(this.implicitScene);
    }
    return this.implicitScene;
  }

  private createScene(title: string): SequenceSceneIR {
    const resolved = title.trim() || '时序';
    const id = buildEntityIdFromTitle(resolved, this.usedIds);
    this.usedIds.add(id);
    this.titleToSceneId.set(resolved, id);
    return {
      id,
      title: resolved,
      participants: [],
      steps: [],
    };
  }

  private ensureParticipant(title: string): SequenceParticipantIR {
    const existingId = this.titleToNodeId.get(title);
    if (existingId) {
      return { id: existingId, title };
    }
    const id = buildEntityIdFromTitle(title, this.usedIds);
    this.usedIds.add(id);
    this.titleToNodeId.set(title, id);
    return { id, title };
  }

  private appendParticipant(scene: SequenceSceneIR, participant: SequenceParticipantIR) {
    if (scene.participants.some((item) => item.id === participant.id)) {
      return;
    }
    scene.participants.push(participant);
  }

  private collectSceneParticipants(scene: SequenceSceneIR): SequenceParticipantIR[] {
    const ordered = [...scene.participants];
    const seen = new Set(ordered.map((item) => item.id));
    const titles = new Map([...this.titleToNodeId.entries()].map(([title, id]) => [id, title]));
    const visit = (items: SequenceStepIR[]) => {
      for (const step of items) {
        if (step.kind === 'message') {
          for (const id of [step.message.from, step.message.to]) {
            if (seen.has(id)) {
              continue;
            }
            seen.add(id);
            ordered.push({ id, title: titles.get(id) ?? id });
          }
          continue;
        }
        visit(step.fragment.steps);
      }
    };
    visit(scene.steps);
    return ordered;
  }

  private nextSeqId(prefix: string) {
    this.seqMessageSalt += 1;
    const used = this.usedIds;
    let id = `${prefix}_${this.seqMessageSalt}`;
    while (used.has(id)) {
      this.seqMessageSalt += 1;
      id = `${prefix}_${this.seqMessageSalt}`;
    }
    used.add(id);
    return id;
  }

  private isSeqArrow(token: Token) {
    return token.kind === 'arrowCall' || token.kind === 'arrowReturn';
  }

  private peekAheadAfterString(): Token {
    let index = this.i + 1;
    while (this.tokens[index]?.kind === 'newline') {
      index += 1;
    }
    return this.tokens[index] ?? { kind: 'eof', value: '', start: 0, end: 0 };
  }

  private readNodeCall() {
    const call = this.parseCall();
    const title = firstString(call.arg);
    if (!title) {
      return;
    }
    this.ensureNode(title, call.attrs);
  }

  private readSubbranch() {
    const call = this.parseCall();
    const startTitle = firstString(call.arg);
    if (!startTitle) {
      this.keepUnsupportedFrom(call);
      return;
    }
    if (this.isArrow(this.peek())) {
      this.readHops(startTitle, call.attrs);
      return;
    }
    this.ensureNode(startTitle, call.attrs);
  }

  private readChainOrNode() {
    if (this.peek().kind === 'lbrack') {
      this.keepUnsupported();
      return;
    }
    const startTitle = this.expectString();
    if (this.isArrow(this.peek())) {
      const attrs = this.tryAttrsAfterHops();
      this.readHops(startTitle, attrs);
      return;
    }
    const attrs = this.peek().kind === 'lbrack' ? this.parseAttrs() : emptyAttrs();
    this.ensureNode(startTitle, attrs);
  }

  private tryAttrsAfterHops(): AttrMap {
    return emptyAttrs();
  }

  private readHops(startTitle: string, leadingAttrs: AttrMap) {
    let current = startTitle;
    const touched: EdgeIR[] = [];
    this.ensureGraphEndpoint(current, emptyAttrs());
    while (this.isArrow(this.peek())) {
      const op = this.next();
      const edgeLabel = this.tryEdgeLabel();
      const target = this.readEndpoint();
      const fromTitle = op.kind === 'arrowLeft' ? target : current;
      const toTitle = op.kind === 'arrowLeft' ? current : target;
      const kind = op.kind === 'dash' ? 'line' : 'solid';
      this.ensureGraphEndpoint(fromTitle, emptyAttrs());
      this.ensureGraphEndpoint(toTitle, emptyAttrs());
      const edge = this.addEdge(fromTitle, toTitle, edgeLabel, kind);
      if (edge) {
        touched.push(edge);
      }
      current = target;
    }
    const attrs = this.peek().kind === 'lbrack' ? this.parseAttrs() : leadingAttrs;
    if (attrs.comment || attrs.todo || attrs.url) {
      for (const edge of touched) {
        mergeSubject(edge, attrs);
      }
    }
  }

  private readEndpoint(): string {
    if (this.peek().kind === 'at') {
      const call = this.parseCall();
      const name = call.name.toLowerCase();
      if (name === 'backto' || name === 'node' || name === 'subbranch') {
        return firstString(call.arg) ?? call.name;
      }
      return firstString(call.arg) ?? call.name;
    }
    return this.expectString();
  }

  private tryEdgeLabel() {
    if (this.peek().kind !== 'pipe') {
      return '';
    }
    this.next();
    let label = '';
    if (this.peek().kind === 'string') {
      label = this.next().value;
    }
    if (this.peek().kind === 'pipe') {
      this.next();
    }
    return label;
  }

  private ingestGroup(call: Value & { kind: 'call' }, parentId: string | null = null) {
    const extracted = extractGroup(call);
    if (!extracted) {
      return;
    }
    const group = this.ensureGroup(extracted.name, extracted.attrs, parentId);
    for (const member of extracted.members) {
      if (typeof member === 'string') {
        const node = this.ensureNode(member, emptyAttrs());
        if (!node.groupId) {
          this.nodes.set(node.id, { ...node, groupId: group.id });
        }
        continue;
      }
      this.ingestGroup(member, group.id);
    }
  }

  private ensureNode(title: string, attrs: AttrMap): NodeIR {
    const existingId = this.titleToNodeId.get(title);
    if (existingId) {
      const current = this.nodes.get(existingId);
      if (current) {
        mergeSubject(current, attrs);
        this.nodes.set(existingId, current);
        return current;
      }
      const materialized: NodeIR = {
        id: existingId,
        title,
        label: '',
        shape: 'rect',
        groupId: null,
      };
      mergeSubject(materialized, attrs);
      this.nodes.set(existingId, materialized);
      return materialized;
    }
    const id = buildEntityIdFromTitle(title, this.usedIds);
    this.usedIds.add(id);
    const node: NodeIR = {
      id,
      title,
      label: '',
      shape: 'rect',
      groupId: null,
    };
    mergeSubject(node, attrs);
    this.nodes.set(id, node);
    this.titleToNodeId.set(title, id);
    return node;
  }

  private ensureGroup(title: string, attrs: AttrMap, parentId: string | null): GroupIR {
    const existingId = this.titleToGroupId.get(title);
    if (existingId) {
      const current = this.groups.get(existingId)!;
      mergeSubject(current, attrs);
      if (parentId && !current.parentId) {
        current.parentId = parentId;
      }
      this.groups.set(existingId, current);
      return current;
    }
    const id = buildEntityIdFromTitle(title, this.usedIds);
    this.usedIds.add(id);
    const group: GroupIR = { id, title, parentId };
    mergeSubject(group, attrs);
    this.groups.set(id, group);
    this.titleToGroupId.set(title, id);
    return group;
  }

  private ensureGraphEndpoint(title: string, attrs: AttrMap) {
    const blockId = this.titleToSceneId.get(title) ?? this.titleToMindId.get(title);
    const nodeId = this.titleToNodeId.get(title);
    if (blockId && !(nodeId && this.nodes.has(nodeId))) {
      return;
    }
    this.ensureNode(title, attrs);
  }

  private endpointId(title: string) {
    const nodeId = this.titleToNodeId.get(title);
    if (nodeId && this.nodes.has(nodeId)) {
      return nodeId;
    }
    return this.titleToSceneId.get(title) ?? this.titleToMindId.get(title);
  }

  private isStubGraphNode(node: NodeIR) {
    return !node.groupId
      && !node.comment
      && !node.todo
      && !node.url
      && (!node.label || node.label === node.title);
  }

  private relinkSequenceEndpoints() {
    for (const scene of this.scenes) {
      const nodeId = this.titleToNodeId.get(scene.title);
      if (!nodeId || nodeId === scene.id) {
        continue;
      }
      const node = this.nodes.get(nodeId);
      if (!node || !this.isStubGraphNode(node)) {
        continue;
      }
      for (const edge of this.edges) {
        if (edge.from === nodeId) {
          edge.from = scene.id;
        }
        if (edge.to === nodeId) {
          edge.to = scene.id;
        }
      }
      this.nodes.delete(nodeId);
      this.titleToNodeId.delete(scene.title);
    }
  }

  private relinkMindEndpoints() {
    for (const map of this.maps) {
      const nodeId = this.titleToNodeId.get(map.title);
      if (!nodeId || nodeId === map.id) {
        continue;
      }
      const node = this.nodes.get(nodeId);
      if (!node || !this.isStubGraphNode(node)) {
        continue;
      }
      for (const edge of this.edges) {
        if (edge.from === nodeId) {
          edge.from = map.id;
        }
        if (edge.to === nodeId) {
          edge.to = map.id;
        }
      }
      this.nodes.delete(nodeId);
      this.titleToNodeId.delete(map.title);
    }
  }

  private addEdge(fromTitle: string, toTitle: string, label: string, kind: EdgeIR['kind']): EdgeIR | null {
    const from = this.endpointId(fromTitle);
    const to = this.endpointId(toTitle);
    if (!from || !to) {
      return null;
    }
    const existing = this.edges.find((item) => item.from === from && item.to === to && item.kind === kind);
    if (existing) {
      if (!existing.label && label) {
        existing.label = label;
      }
      return existing;
    }
    const edge: EdgeIR = {
      id: this.nextEdgeId(from, to),
      from,
      to,
      label,
      kind,
    };
    this.edges.push(edge);
    return edge;
  }

  private nextEdgeId(from: string, to: string) {
    const used = new Set(this.edges.map((edge) => edge.id));
    let salt = 0;
    while (salt < 10000) {
      const id = salt === 0 ? `e_${from}_${to}` : `e_${from}_${to}_${salt}`;
      if (!used.has(id)) {
        return id;
      }
      salt += 1;
    }
    return `e_${from}_${to}_${Date.now()}`;
  }

  private parseCall(): Value & { kind: 'call' } {
    const at = this.expect('at');
    if (this.peek().kind === 'colon') {
      this.next();
    }
    let arg: Value | null = null;
    const kind = this.peek().kind;
    if (kind === 'string' || kind === 'lparen' || kind === 'at') {
      arg = this.parseValue();
    }
    const attrs = this.peek().kind === 'lbrack' ? this.parseAttrs() : emptyAttrs();
    return { kind: 'call', name: at.value, arg, attrs };
  }

  private parseValue(): Value {
    const token = this.peek();
    if (token.kind === 'string') {
      return { kind: 'string', value: this.next().value };
    }
    if (token.kind === 'at') {
      return this.parseCall();
    }
    if (token.kind === 'lparen') {
      this.next();
      const items: Value[] = [];
      while (!this.eof() && this.peek().kind !== 'rparen') {
        this.skipNewlines();
        if (this.peek().kind === 'rparen' || this.peek().kind === 'eof') {
          break;
        }
        if (this.peek().kind === 'comma') {
          this.next();
          continue;
        }
        items.push(this.parseValue());
        this.skipNewlines();
        if (this.peek().kind === 'comma') {
          this.next();
        }
      }
      if (this.peek().kind === 'rparen') {
        this.next();
      }
      return { kind: 'list', items };
    }
    return { kind: 'string', value: this.next().value };
  }

  private parseAttrs(): AttrMap {
    const attrs = emptyAttrs();
    if (this.peek().kind !== 'lbrack') {
      return attrs;
    }
    this.next();
    while (!this.eof() && this.peek().kind !== 'rbrack') {
      this.skipNewlines();
      if (this.peek().kind === 'rbrack') {
        break;
      }
      if (this.peek().kind === 'comma') {
        this.next();
        continue;
      }
      if (this.peek().kind === 'string') {
        const comment = this.next().value;
        attrs.comment = attrs.comment ?? comment;
        continue;
      }
      if (this.peek().kind === 'at') {
        const call = this.parseCall();
        applyAttr(attrs, call);
        continue;
      }
      this.next();
    }
    if (this.peek().kind === 'rbrack') {
      this.next();
    }
    return attrs;
  }

  private keepUnsupported() {
    const start = this.peek().start;
    this.skipBalanced();
    const end = this.tokens[Math.max(0, this.i - 1)]?.end ?? start;
    const line = this.source.slice(start, end).trim();
    if (line) {
      this.unsupported.push(line);
    }
  }

  private keepUnsupportedFrom(_call: Value) {
    this.keepUnsupported();
  }

  private skipBalanced() {
    let depth = 0;
    while (!this.eof()) {
      const kind = this.peek().kind;
      if (kind === 'newline' && depth === 0) {
        this.next();
        return;
      }
      if (kind === 'lparen' || kind === 'lbrack') {
        depth += 1;
      }
      if (kind === 'rparen' || kind === 'rbrack') {
        depth = Math.max(0, depth - 1);
      }
      this.next();
    }
  }

  private isArrow(token: Token) {
    return token.kind === 'arrow' || token.kind === 'arrowLeft' || token.kind === 'dash';
  }

  private skipNewlines() {
    while (this.peek().kind === 'newline') {
      this.next();
    }
  }

  private expectString() {
    if (this.peek().kind === 'string') {
      return this.next().value;
    }
    if (this.peek().kind === 'at') {
      return firstString(this.parseCall().arg) ?? '';
    }
    return this.next().value;
  }

  private expect(kind: Token['kind']) {
    const token = this.next();
    if (token.kind !== kind) {
      return token;
    }
    return token;
  }

  private peek() {
    return this.tokens[this.i] ?? this.tokens[this.tokens.length - 1]!;
  }

  private next() {
    const token = this.peek();
    if (token.kind !== 'eof') {
      this.i += 1;
    }
    return token;
  }

  private eof() {
    return this.peek().kind === 'eof';
  }
}

function emptyAttrs(): AttrMap {
  return { extra: [] };
}

function firstString(value: Value | null): string | undefined {
  if (!value) {
    return undefined;
  }
  if (value.kind === 'string') {
    return value.value;
  }
  if (value.kind === 'list') {
    return firstString(value.items[0] ?? null);
  }
  if (value.kind === 'call') {
    return firstString(value.arg);
  }
  return undefined;
}

function applyAttr(attrs: AttrMap, call: Value & { kind: 'call' }) {
  const name = call.name.toLowerCase();
  if (name === 'comment') {
    attrs.comment = firstString(call.arg) ?? attrs.comment;
    return;
  }
  if (name === 'url') {
    attrs.url = firstString(call.arg) ?? attrs.url;
    return;
  }
  if (name === 'members') {
    attrs.members = call.arg?.kind === 'list' ? call.arg.items : call.arg ? [call.arg] : [];
    return;
  }
  if (name === 'todo.message') {
    attrs.todo = { ...attrs.todo, message: firstString(call.arg) };
    return;
  }
  if (name === 'todo.prio') {
    attrs.todo = { ...attrs.todo, prio: firstString(call.arg) };
    return;
  }
  if (name === 'todo.status') {
    attrs.todo = { ...attrs.todo, status: firstString(call.arg) };
    return;
  }
  attrs.extra.push({ name: call.name, value: call });
}

function mergeSubject(target: { comment?: string; todo?: TodoIR; url?: string }, attrs: AttrMap) {
  if (attrs.comment) {
    target.comment = attrs.comment;
  }
  if (attrs.url) {
    target.url = attrs.url;
  }
  if (attrs.todo) {
    target.todo = { ...target.todo, ...attrs.todo };
  }
}

type GroupExtract = {
  name: string;
  members: Array<string | (Value & { kind: 'call' })>;
  attrs: AttrMap;
};

function extractGroup(call: Value & { kind: 'call' }): GroupExtract | null {
  const attrs = { ...call.attrs };
  const members: Array<string | (Value & { kind: 'call' })> = [];
  const fromAttrs = attrs.members ?? [];
  collectMembers(fromAttrs, members);

  let name = firstString(call.arg) ?? '';
  if (call.arg?.kind === 'list') {
    const [head, ...rest] = call.arg.items;
    name = firstString(head ?? null) ?? name;
    if (rest.length === 1 && rest[0]?.kind === 'list') {
      collectMembers(rest[0].items, members);
    } else {
      collectMembers(rest, members);
    }
  }

  if (!name) {
    return null;
  }
  return { name, members, attrs };
}

function collectMembers(values: Value[], out: Array<string | (Value & { kind: 'call' })>) {
  for (const value of values) {
    if (value.kind === 'string') {
      out.push(value.value);
      continue;
    }
    if (value.kind === 'list') {
      collectMembers(value.items, out);
      continue;
    }
    if (value.kind === 'call') {
      const name = value.name.toLowerCase();
      if (name === 'members') {
        collectMembers(value.arg?.kind === 'list' ? value.arg.items : value.arg ? [value.arg] : [], out);
        continue;
      }
      if (name === 'group' || name === 'groud' || name === 'node') {
        if (name === 'node') {
          const title = firstString(value.arg);
          if (title) {
            out.push(title);
          }
          continue;
        }
        out.push(value);
      }
    }
  }
}
