import { isPlaceholderTitle } from '../../../domain/label';
import { DEFAULT_GROUP_STYLE, DEFAULT_NODE_STYLE } from '../../../domain/style';
import { MIND_HEADER, SEQ_HEADER, nodeContentBands } from '../../../placement';
import { edgeLabelWorldChip, groupTitleLabel, groupTitleViewChip, visibleEdgeLabel } from '../labelChips';
import type { SceneContext } from '../paint/context';
import { collectGroupTitleObstacles } from '../paint/groups';
import { SCREEN_DESC_LINE, SCREEN_DESC_PX, SCREEN_EDGE_PX, SCREEN_GROUP_PX, SCREEN_TITLE_LINE, SCREEN_TITLE_PX } from '../paint/theme';
import type { StageInlineEdit, StageInlineField, StageInlinePane } from '../stageTypes';

export function buildInlineEdit(
  scene: SceneContext,
  kind: StageInlineEdit['kind'],
  id: string,
  field: StageInlineField,
  sceneId?: string,
): StageInlineEdit | null {
  const measure = (text: string, font: string) => scene.cache.measureScreenWidth(scene.ctx, text, font);
  if (kind === 'node') {
    const node = scene.nodeMap.get(id);
    if (!node) {
      return null;
    }
    const bands = nodeContentBands(node);
    const fill = node.fill || DEFAULT_NODE_STYLE.fill;
    const stroke = node.stroke || DEFAULT_NODE_STYLE.stroke;
    const color = node.textColor || DEFAULT_NODE_STYLE.textColor;
    const details = scene.metrics.showsDetails;
    const titleView = scene.camera.worldRectToView(details ? bands.title : {
      x: node.x,
      y: node.y,
      width: node.width,
      height: node.height,
    });
    const titleFit = scene.cache.fitNodeText(
      id,
      't',
      bands.titleLines.length > 0 ? bands.titleLines : [bands.parts.title],
      titleView,
      SCREEN_TITLE_PX,
      SCREEN_TITLE_LINE,
      scene.metrics.lod,
    );
    const titlePane: StageInlinePane = {
      field: 'title',
      value: bands.parts.title,
      viewRect: titleView,
      fill,
      color,
      fontSize: titleFit.fontPx,
      fontWeight: 800,
      selectAll: isPlaceholderTitle(bands.parts.title)
        && !(scene.inlineSession?.kind === 'node' && scene.inlineSession.id === id),
      multiline: false,
      placeholder: '未命名内容',
    };
    if (!details) {
      return { kind, id, stroke, ...titlePane };
    }
    const descView = scene.camera.worldRectToView(bands.description);
    const descFit = scene.cache.fitNodeText(
      id,
      'd',
      bands.descriptionLines.length > 0 ? bands.descriptionLines : ['（空）'],
      descView,
      SCREEN_DESC_PX,
      SCREEN_DESC_LINE,
      scene.metrics.lod,
    );
    const descPane: StageInlinePane = {
      field: 'description',
      value: bands.parts.description,
      viewRect: descView,
      fill,
      color,
      fontSize: descFit.fontPx,
      fontWeight: 500,
      selectAll: false,
      multiline: true,
      placeholder: '（空）',
    };
    const active = field === 'description' ? descPane : titlePane;
    const companion = field === 'description' ? titlePane : descPane;
    return { kind, id, stroke, ...active, companion };
  }
  if (kind === 'edge') {
    const edge = scene.doc.edges.find((entry) => entry.id === id);
    const geometry = scene.edgeRoutes.get(id);
    if (!edge || !geometry) {
      return null;
    }
    const text = edge.label.trim() || ' ';
    const center = visibleEdgeLabel(geometry, text, {
      camera: scene.camera,
      cssW: scene.cssW,
      cssH: scene.cssH,
      showsDetails: scene.metrics.showsDetails,
      measure,
      avoid: scene.cache.paintLabelAvoid ?? collectGroupTitleObstacles(scene),
    }) ?? geometry.label;
    const chip = edgeLabelWorldChip(scene.camera, text, center, measure);
    const view = scene.camera.worldRectToView(chip);
    return {
      kind,
      id,
      field: 'label',
      value: edge.label,
      viewRect: {
        ...view,
        width: Math.max(view.width, 72),
        height: Math.max(view.height, 22),
      },
      fill: '#111214',
      color: '#e8e8ee',
      fontSize: SCREEN_EDGE_PX,
      fontWeight: 600,
      selectAll: edge.label.length > 0,
      multiline: false,
    };
  }
  if (kind === 'group') {
    const group = scene.doc.subgraphs.find((entry) => entry.id === id);
    const rect = scene.groupRectCache.get(id);
    if (!group || !rect) {
      return null;
    }
    return {
      kind,
      id,
      field: 'title',
      value: group.title,
      viewRect: groupTitleViewChip(
        scene.camera,
        rect,
        groupTitleLabel(Boolean(group.collapsed), group.title),
        measure,
      ),
      fill: 'rgba(0,0,0,0.35)',
      color: group.textColor || DEFAULT_GROUP_STYLE.textColor,
      fontSize: SCREEN_GROUP_PX,
      fontWeight: 700,
      selectAll: false,
      multiline: false,
    };
  }
  if (kind === 'sequence') {
    const frame = scene.seqFrames.find((item) => item.id === id);
    const seq = scene.doc.sequence?.scenes.find((item) => item.id === id);
    if (!frame || !seq) {
      return null;
    }
    return {
      kind,
      id,
      field: 'title',
      value: seq.title,
      viewRect: scene.camera.worldRectToView({
        x: frame.x + 12,
        y: frame.y,
        width: Math.max(80, frame.width - 40),
        height: SEQ_HEADER,
      }),
      fill: 'rgba(32, 18, 42, 0.94)',
      color: '#f3e8ff',
      fontSize: SCREEN_GROUP_PX,
      fontWeight: 700,
      selectAll: false,
      multiline: false,
    };
  }
  if (kind === 'seq-actor') {
    const model = scene.sequenceModel(sceneId ?? '');
    const column = model?.columns.find((item) => item.id === id);
    const actor = scene.doc.sequence?.scenes
      .find((item) => item.id === sceneId)
      ?.participants.find((item) => item.id === id);
    if (!model || !column || !actor) {
      return null;
    }
    return {
      kind,
      id,
      sceneId,
      field: 'title',
      value: actor.title,
      viewRect: scene.camera.worldRectToView(column.chip),
      fill: 'rgba(32, 18, 42, 0.94)',
      color: '#f4f4f5',
      fontSize: SCREEN_GROUP_PX,
      fontWeight: 700,
      selectAll: true,
      multiline: false,
    };
  }
  if (kind === 'seq-message') {
    const model = scene.sequenceModel(sceneId ?? '');
    const message = model?.messages.find((item) => item.id === id);
    if (!model || !message) {
      return null;
    }
    return {
      kind,
      id,
      sceneId,
      field: 'label',
      value: message.label,
      viewRect: scene.camera.worldRectToView({
        x: message.hit.x,
        y: message.hit.y,
        width: Math.max(72, message.hit.width),
        height: Math.max(22, message.hit.height),
      }),
      fill: '#111214',
      color: '#e8e8ee',
      fontSize: SCREEN_EDGE_PX,
      fontWeight: 600,
      selectAll: true,
      multiline: false,
    };
  }
  if (kind === 'mind') {
    const frame = scene.mindFrames.find((item) => item.id === id);
    const map = scene.doc.mind?.maps.find((item) => item.id === id);
    if (!frame || !map) {
      return null;
    }
    return {
      kind,
      id,
      field: 'title',
      value: map.title,
      viewRect: scene.camera.worldRectToView({
        x: frame.x + 12,
        y: frame.y,
        width: Math.max(80, frame.width - 40),
        height: MIND_HEADER,
      }),
      fill: 'rgba(8, 22, 24, 0.94)',
      color: '#ccfbf1',
      fontSize: SCREEN_GROUP_PX,
      fontWeight: 700,
      selectAll: false,
      multiline: false,
    };
  }
  if (kind === 'mind-node') {
    const model = scene.mindModel(sceneId ?? '');
    const topic = model?.nodes.find((item) => item.id === id) ?? (model?.root.id === id ? model.root : null);
    if (!model || !topic) {
      return null;
    }
    return {
      kind,
      id,
      sceneId,
      field: 'title',
      value: topic.title,
      viewRect: scene.camera.worldRectToView(topic.box),
      fill: 'rgba(8, 22, 24, 0.94)',
      color: '#ecfeff',
      fontSize: SCREEN_GROUP_PX,
      fontWeight: 700,
      selectAll: true,
      multiline: false,
    };
  }
  const frame = scene.frameById(id);
  if (!frame) {
    return null;
  }
  return {
    kind,
    id,
    field: 'title',
    value: frame.title,
    viewRect: scene.camera.worldRectToView({
      x: frame.x + 10,
      y: frame.y,
      width: Math.max(64, frame.width - 20),
      height: 26,
    }),
    fill: 'rgba(20, 40, 46, 0.9)',
    color: '#d9fbff',
    fontSize: SCREEN_GROUP_PX,
    fontWeight: 700,
    selectAll: false,
    multiline: false,
  };
}
