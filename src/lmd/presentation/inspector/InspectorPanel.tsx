import type { GraphDocument } from '../..';
import type { LayoutFrame } from '../../infrastructure/layout';
import { readLayoutFrames } from '../../infrastructure/layout';
import type { StageSelection } from '../canvas/engine';
import { findMindTopic, findSequenceMessage } from '../../application/editing';
import { flattenMindNodes } from '@lths/lmd/legacy';
import { flattenSequenceSteps } from '../../placement/sequence';
import { splitEntityText } from '../../domain/label';
import { edgeTypeOptions, nodeStylePresets, shapeOptions } from './presets';

export type InspectorPane = 'inspect' | 'outline' | 'project';

type InspectorPanelProps = {
  document: GraphDocument;
  selection: StageSelection;
  pane: InspectorPane;
  onPaneChange: (pane: InspectorPane) => void;
  onClose: () => void;
  onPatchNode: (
    nodeId: string,
    patch: {
      title?: string;
      description?: string;
      shape?: GraphDocument['nodes'][number]['shape'];
      fill?: string;
      stroke?: string;
      textColor?: string;
    },
  ) => void;
  onPatchEdge: (
    edgeId: string,
    patch: {
      label?: string;
      type?: GraphDocument['edges'][number]['type'];
      strokeColor?: string;
      strokeWidth?: number;
    },
  ) => void;
  onPatchGroup: (
    subgraphId: string,
    patch: { title?: string; fill?: string; stroke?: string; textColor?: string },
  ) => void;
  onPatchProject: (patch: {
    projectName?: string;
    projectSummary?: string;
    contentMarkdown?: string;
  }) => void;
  onSelect?: (selection: StageSelection) => void;
  onPatchFrame?: (frameId: string, patch: { title?: string; padding?: number }) => void;
  onPatchSequence?: (sceneId: string, patch: { title?: string }) => void;
  onPatchSequenceActor?: (sceneId: string, participantId: string, patch: { title?: string }) => void;
  onPatchSequenceMessage?: (
    sceneId: string,
    messageId: string,
    patch: { label?: string; arrow?: 'call' | 'return' },
  ) => void;
  onAddSequenceActor?: (sceneId: string) => void;
  onAddSequenceMessage?: (sceneId: string) => void;
  onPatchMind?: (mapId: string, patch: { title?: string }) => void;
  onPatchMindTopic?: (mapId: string, topicId: string, patch: { title?: string; comment?: string }) => void;
  onAddMindTopic?: (mapId: string, parentId?: string) => void;
  onReflowFrame?: () => void;
  onReleaseFrame?: () => void;
};

export function InspectorPanel({
  document,
  selection,
  pane,
  onPaneChange,
  onClose,
  onPatchNode,
  onPatchEdge,
  onPatchGroup,
  onPatchProject,
  onSelect,
  onPatchFrame,
  onPatchSequence,
  onPatchSequenceActor,
  onPatchSequenceMessage,
  onAddSequenceActor,
  onAddSequenceMessage,
  onPatchMind,
  onPatchMindTopic,
  onAddMindTopic,
  onReflowFrame,
  onReleaseFrame,
}: InspectorPanelProps) {
  const primaryNode =
    selection.kind === 'node' && selection.ids.length === 1
      ? document.nodes.find((node) => node.id === selection.ids[0])
      : null;
  const primaryEdge =
    selection.kind === 'edge' && selection.ids.length === 1
      ? document.edges.find((edge) => edge.id === selection.ids[0])
      : null;
  const primaryGroup =
    selection.kind === 'group' && selection.ids.length === 1
      ? document.subgraphs.find((subgraph) => subgraph.id === selection.ids[0])
      : null;
  const frames = readLayoutFrames(document.compat?.extras as Record<string, unknown> | undefined);
  const primaryFrame: LayoutFrame | null =
    selection.kind === 'frame' && selection.ids.length === 1
      ? frames.find((frame) => frame.id === selection.ids[0]) ?? null
      : null;
  const sequenceSceneId =
    selection.kind === 'sequence'
      ? selection.ids[0] ?? null
      : selection.kind === 'seq-actor' || selection.kind === 'seq-message'
        ? selection.sceneId
        : null;
  const primarySequence = sequenceSceneId
    ? document.sequence?.scenes.find((scene) => scene.id === sequenceSceneId) ?? null
    : null;
  const primaryActor =
    selection.kind === 'seq-actor' && selection.ids[0]
      ? primarySequence?.participants.find((item) => item.id === selection.ids[0]) ?? null
      : null;
  const primaryMessage =
    selection.kind === 'seq-message' && selection.ids[0] && sequenceSceneId
      ? findSequenceMessage(document, sequenceSceneId, selection.ids[0])
      : null;
  const mindMapId =
    selection.kind === 'mind'
      ? selection.ids[0] ?? null
      : selection.kind === 'mind-node'
        ? selection.mapId
        : null;
  const primaryMind = mindMapId
    ? document.mind?.maps.find((map) => map.id === mindMapId) ?? null
    : null;
  const primaryMindTopic =
    selection.kind === 'mind-node' && selection.ids[0] && mindMapId
      ? findMindTopic(document, mindMapId, selection.ids[0])
      : null;

  const isNodeSelected = (id: string) =>
    (selection.kind === 'node' && selection.ids.includes(id))
    || (selection.kind === 'mixed' && selection.nodes.includes(id));
  const isGroupSelected = (id: string) =>
    (selection.kind === 'group' && selection.ids.includes(id))
    || (selection.kind === 'mixed' && selection.groups.includes(id));
  const isEdgeSelected = (id: string) =>
    (selection.kind === 'edge' && selection.ids.includes(id))
    || (selection.kind === 'mixed' && selection.edges.includes(id));
  const isSequenceSelected = (id: string) =>
    (selection.kind === 'sequence' && selection.ids.includes(id))
    || (selection.kind === 'mixed' && selection.sequences.includes(id))
    || ((selection.kind === 'seq-actor' || selection.kind === 'seq-message') && selection.sceneId === id);
  const isSeqActorSelected = (id: string) =>
    selection.kind === 'seq-actor' && selection.ids.includes(id);
  const isSeqMessageSelected = (id: string) =>
    selection.kind === 'seq-message' && selection.ids.includes(id);
  const isMindSelected = (id: string) =>
    (selection.kind === 'mind' && selection.ids.includes(id))
    || (selection.kind === 'mixed' && selection.minds.includes(id))
    || (selection.kind === 'mind-node' && selection.mapId === id);
  const isMindTopicSelected = (id: string) =>
    selection.kind === 'mind-node' && selection.ids.includes(id);

  return (
    <aside className="flow-inspector" aria-label="侧栏">
      <div className="flow-inspector__head">
        <div className="flow-tabs" role="tablist">
          <button
            className={pane === 'inspect' ? 'is-active' : undefined}
            onClick={() => onPaneChange('inspect')}
            type="button"
          >
            属性
          </button>
          <button
            className={pane === 'outline' ? 'is-active' : undefined}
            onClick={() => onPaneChange('outline')}
            type="button"
          >
            大纲
          </button>
          <button
            className={pane === 'project' ? 'is-active' : undefined}
            onClick={() => onPaneChange('project')}
            type="button"
          >
            工程
          </button>
        </div>
        <button aria-label="关闭侧栏" className="flow-iconbtn" onClick={onClose} type="button">
          ✕
        </button>
      </div>
      <div className="flow-inspector__scroll">
        {pane === 'project' ? (
          <section className="flow-inspector__section">
            <label className="flow-field">
              <span>名称</span>
              <input
                onChange={(event) => onPatchProject({ projectName: event.target.value })}
                value={document.projectName || ''}
              />
            </label>
            <label className="flow-field">
              <span>摘要</span>
              <textarea
                onChange={(event) => onPatchProject({ projectSummary: event.target.value })}
                rows={3}
                value={document.projectSummary || ''}
              />
            </label>
            <label className="flow-field">
              <span>附加信息 Content</span>
              <textarea
                onChange={(event) => onPatchProject({ contentMarkdown: event.target.value })}
                rows={8}
                value={document.contentMarkdown || ''}
              />
            </label>
          </section>
        ) : null}

        {pane === 'inspect' ? (
          <>
            {primaryNode ? (
              <section className="flow-inspector__section">
                <h3>节点</h3>
                <label className="flow-field">
                  <span>标题</span>
                  <input
                    data-inspector="node-title"
                    onChange={(event) =>
                      onPatchNode(primaryNode.id, { title: event.target.value })
                    }
                    value={splitEntityText(primaryNode.label).title}
                  />
                </label>
                <label className="flow-field">
                  <span>描述</span>
                  <textarea
                    data-inspector="node-description"
                    onChange={(event) =>
                      onPatchNode(primaryNode.id, { description: event.target.value })
                    }
                    rows={3}
                    value={splitEntityText(primaryNode.label).description}
                  />
                </label>
                <label className="flow-field">
                  <span>形状</span>
                  <select
                    onChange={(event) =>
                      onPatchNode(primaryNode.id, {
                        shape: event.target.value as typeof primaryNode.shape,
                      })
                    }
                    value={primaryNode.shape}
                  >
                    {shapeOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="flow-field">
                  <span>配色</span>
                  <div className="flow-swatches">
                    {nodeStylePresets.map((preset) => (
                      <button
                        className="flow-swatch"
                        key={preset.id}
                        onClick={() =>
                          onPatchNode(primaryNode.id, {
                            fill: preset.fill,
                            stroke: preset.stroke,
                            textColor: preset.textColor,
                          })
                        }
                        style={{
                          background: preset.fill,
                          borderColor: preset.stroke,
                          color: preset.textColor,
                        }}
                        title={preset.label}
                        type="button"
                      >
                        {preset.label.slice(0, 1)}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="flow-field-hint">ID: {primaryNode.id}</div>
              </section>
            ) : null}

            {primaryEdge ? (
              <section className="flow-inspector__section">
                <h3>连线</h3>
                <label className="flow-field">
                  <span>标签</span>
                  <input
                    data-inspector="edge-label"
                    onChange={(event) =>
                      onPatchEdge(primaryEdge.id, { label: event.target.value })
                    }
                    value={primaryEdge.label}
                  />
                </label>
                <label className="flow-field">
                  <span>类型</span>
                  <select
                    onChange={(event) =>
                      onPatchEdge(primaryEdge.id, {
                        type: event.target.value as typeof primaryEdge.type,
                      })
                    }
                    value={primaryEdge.type}
                  >
                    {edgeTypeOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flow-field">
                  <span>颜色</span>
                  <input
                    onChange={(event) =>
                      onPatchEdge(primaryEdge.id, { strokeColor: event.target.value })
                    }
                    type="color"
                    value={
                      /^#[0-9a-fA-F]{6}$/.test(primaryEdge.strokeColor)
                        ? primaryEdge.strokeColor
                        : '#8a8a94'
                    }
                  />
                </label>
                <div className="flow-field-hint">
                  {primaryEdge.from} → {primaryEdge.to}
                </div>
              </section>
            ) : null}

            {primaryGroup ? (
              <section className="flow-inspector__section">
                <h3>分组</h3>
                <label className="flow-field">
                  <span>标题</span>
                  <input
                    data-inspector="group-title"
                    onChange={(event) =>
                      onPatchGroup(primaryGroup.id, { title: event.target.value })
                    }
                    value={primaryGroup.title}
                  />
                </label>
                <div className="flow-field">
                  <span>配色</span>
                  <div className="flow-swatches">
                    {nodeStylePresets.slice(0, 8).map((preset) => (
                      <button
                        className="flow-swatch"
                        key={preset.id}
                        onClick={() =>
                          onPatchGroup(primaryGroup.id, {
                            fill: preset.fill,
                            stroke: preset.stroke,
                            textColor: preset.textColor,
                          })
                        }
                        style={{
                          background: preset.fill,
                          borderColor: preset.stroke,
                          color: preset.textColor,
                        }}
                        title={preset.label}
                        type="button"
                      >
                        {preset.label.slice(0, 1)}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="flow-field-hint">点分组 ▾ 可折叠 / 展开</div>
              </section>
            ) : null}

            {primaryFrame ? (
              <section className="flow-inspector__section">
                <h3>形状框</h3>
                <label className="flow-field">
                  <span>名称</span>
                  <input
                    data-inspector="frame-title"
                    onChange={(event) => onPatchFrame?.(primaryFrame.id, { title: event.target.value })}
                    value={primaryFrame.title}
                  />
                </label>
                <label className="flow-field">
                  <span>内边距</span>
                  <input
                    min={12}
                    onChange={(event) =>
                      onPatchFrame?.(primaryFrame.id, { padding: Number(event.target.value) || 28 })
                    }
                    type="number"
                    value={primaryFrame.padding}
                  />
                </label>
                <div className="flow-field-hint">
                  {Math.round(primaryFrame.width)} × {Math.round(primaryFrame.height)} · {primaryFrame.nodeIds.length} 个节点
                </div>
                <div className="flow-field flow-field--row">
                  <button className="flow-btn" onClick={onReflowFrame} type="button">
                    重新排布
                  </button>
                  <button className="flow-btn" onClick={onReleaseFrame} type="button">
                    解除形状框
                  </button>
                </div>
                <div className="flow-field-hint">
                  拖边或角改形状，框内会按拓扑重排。删除只去掉框。
                </div>
              </section>
            ) : null}

            {primarySequence ? (
              <section className="flow-inspector__section">
                <h3>时序块</h3>
                <label className="flow-field">
                  <span>标题</span>
                  <input
                    data-inspector="sequence-title"
                    onChange={(event) => onPatchSequence?.(primarySequence.id, { title: event.target.value })}
                    value={primarySequence.title}
                  />
                </label>
                <div className="flow-field flow-field--row">
                  <button className="flow-btn" onClick={() => onAddSequenceActor?.(primarySequence.id)} type="button">
                    加一列
                  </button>
                  <button className="flow-btn" onClick={() => onAddSequenceMessage?.(primarySequence.id)} type="button">
                    加一条消息
                  </button>
                </div>
                <div className="flow-field-hint">
                  双击列名/消息改文字；双击空白在该处加列（柱）；拖列左右排序；拖消息上下排序；空白框选；拖标题栏挪整块；选中后拖端口或右键从块连到节点；在竖线上按住右键拖到目标激活柱画方向连线（向左=返回）；左键拖生命线也可画消息；Del 删选中项
                </div>
              </section>
            ) : null}

            {primaryActor && sequenceSceneId ? (
              <section className="flow-inspector__section">
                <h3>参与者</h3>
                <label className="flow-field">
                  <span>名称</span>
                  <input
                    onChange={(event) =>
                      onPatchSequenceActor?.(sequenceSceneId, primaryActor.id, { title: event.target.value })
                    }
                    value={primaryActor.title}
                  />
                </label>
              </section>
            ) : null}

            {primaryMind ? (
              <section className="flow-inspector__section">
                <h3>思维导图</h3>
                <label className="flow-field">
                  <span>标题</span>
                  <input
                    data-inspector="mind-title"
                    onChange={(event) => onPatchMind?.(primaryMind.id, { title: event.target.value })}
                    value={primaryMind.title}
                  />
                </label>
                <div className="flow-field flow-field--row">
                  <button
                    className="flow-btn"
                    onClick={() => onAddMindTopic?.(primaryMind.id, primaryMindTopic?.id ?? primaryMind.id)}
                    type="button"
                  >
                    加主题
                  </button>
                </div>
                <div className="flow-field-hint">
                  块内用缩进树；源码可写 Markdown 列表。点主题改选中；双击改名；双击空白加子主题；右上角 + 加主题；拖标题栏挪整块；选中后可当单个节点连线；Del 删选中项
                </div>
              </section>
            ) : null}

            {primaryMindTopic && mindMapId ? (
              <section className="flow-inspector__section">
                <h3>主题</h3>
                <label className="flow-field">
                  <span>名称</span>
                  <input
                    onChange={(event) =>
                      onPatchMindTopic?.(mindMapId, primaryMindTopic.id, { title: event.target.value })
                    }
                    value={primaryMindTopic.title}
                  />
                </label>
                <label className="flow-field">
                  <span>注释</span>
                  <input
                    onChange={(event) =>
                      onPatchMindTopic?.(mindMapId, primaryMindTopic.id, { comment: event.target.value })
                    }
                    value={primaryMindTopic.comment ?? ''}
                  />
                </label>
              </section>
            ) : null}

            {primaryMessage && sequenceSceneId ? (
              <section className="flow-inspector__section">
                <h3>消息</h3>
                <label className="flow-field">
                  <span>标签</span>
                  <input
                    onChange={(event) =>
                      onPatchSequenceMessage?.(sequenceSceneId, primaryMessage.id, { label: event.target.value })
                    }
                    value={primaryMessage.label}
                  />
                </label>
                <label className="flow-field">
                  <span>方向</span>
                  <select
                    onChange={(event) =>
                      onPatchSequenceMessage?.(sequenceSceneId, primaryMessage.id, {
                        arrow: event.target.value as 'call' | 'return',
                      })
                    }
                    value={primaryMessage.arrow}
                  >
                    <option value="call">调用 &gt;&gt;</option>
                    <option value="return">返回 &lt;&lt;</option>
                  </select>
                </label>
              </section>
            ) : null}

            {selection.kind !== 'none' && !primaryNode && !primaryEdge && !primaryGroup && !primaryFrame && !primarySequence && !primaryMind ? (
              <section className="flow-inspector__section">
                <h3>多选</h3>
                <p className="flow-field-hint">
                  已选 {selection.ids.length} 项。用底部操作条分组、连线、复制或删除。
                </p>
              </section>
            ) : null}

            {selection.kind === 'none' ? (
              <section className="flow-inspector__section">
                <p className="flow-field-hint">
                  在画布上选中节点、连线、分组、时序块、思维导图或形状框后，属性会出现在这里。时序列/消息和导图主题也可以直接点选、双击改。
                </p>
              </section>
            ) : null}
          </>
        ) : null}

        {pane === 'outline' ? (
          <>
            <section className="flow-inspector__section">
              <h3>图谱</h3>
              <ul className="flow-outline">
                {document.subgraphs.map((subgraph) => (
                  <li key={subgraph.id}>
                    <button
                      className={`flow-outline__btn${isGroupSelected(subgraph.id) ? ' is-active' : ''}`}
                      onClick={() => onSelect?.({ kind: 'group', ids: [subgraph.id] })}
                      type="button"
                    >
                      组 · {subgraph.title}
                      {subgraph.collapsed ? ' ▸' : ''}
                    </button>
                    <ul>
                      {document.nodes
                        .filter((node) => node.subgraphId === subgraph.id)
                        .map((node) => (
                          <li key={node.id}>
                            <button
                              className={`flow-outline__btn${isNodeSelected(node.id) ? ' is-active' : ''}`}
                              onClick={() => onSelect?.({ kind: 'node', ids: [node.id] })}
                              type="button"
                            >
                              {splitEntityText(node.label).title || node.id}
                            </button>
                          </li>
                        ))}
                    </ul>
                  </li>
                ))}
                {document.nodes
                  .filter((node) => !node.subgraphId)
                  .map((node) => (
                    <li key={node.id}>
                      <button
                        className={`flow-outline__btn${isNodeSelected(node.id) ? ' is-active' : ''}`}
                        onClick={() => onSelect?.({ kind: 'node', ids: [node.id] })}
                        type="button"
                      >
                        {splitEntityText(node.label).title || node.id}
                      </button>
                    </li>
                  ))}
              </ul>
            </section>

            {(document.sequence?.scenes.length ?? 0) > 0 ? (
              <section className="flow-inspector__section">
                <h3>时序</h3>
                <ul className="flow-outline">
                  {(document.sequence?.scenes ?? []).map((scene) => (
                    <li key={scene.id}>
                      <button
                        className={`flow-outline__btn${isSequenceSelected(scene.id) ? ' is-active' : ''}`}
                        onClick={() => onSelect?.({ kind: 'sequence', ids: [scene.id] })}
                        type="button"
                      >
                        时序 · {scene.title || '未命名'}
                      </button>
                      <ul>
                        {scene.participants.map((participant) => (
                          <li key={participant.id}>
                            <button
                              className={`flow-outline__btn${isSeqActorSelected(participant.id) ? ' is-active' : ''}`}
                              onClick={() => onSelect?.({ kind: 'seq-actor', sceneId: scene.id, ids: [participant.id] })}
                              type="button"
                            >
                              列 · {participant.title}
                            </button>
                          </li>
                        ))}
                        {flattenSequenceSteps(scene.steps).flatMap((row) => (
                          row.kind === 'message'
                            ? [(
                              <li key={row.id}>
                                <button
                                  className={`flow-outline__btn${isSeqMessageSelected(row.id) ? ' is-active' : ''}`}
                                  onClick={() => onSelect?.({ kind: 'seq-message', sceneId: scene.id, ids: [row.id] })}
                                  type="button"
                                >
                                  {row.arrow === 'return' ? '<<' : '>>'} {row.label || '消息'}
                                </button>
                              </li>
                            )]
                            : []
                        ))}
                      </ul>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            {(document.mind?.maps.length ?? 0) > 0 ? (
              <section className="flow-inspector__section">
                <h3>思维导图</h3>
                <ul className="flow-outline">
                  {(document.mind?.maps ?? []).map((map) => (
                    <li key={map.id}>
                      <button
                        className={`flow-outline__btn${isMindSelected(map.id) ? ' is-active' : ''}`}
                        onClick={() => onSelect?.({ kind: 'mind', ids: [map.id] })}
                        type="button"
                      >
                        导图 · {map.title || '未命名'}
                      </button>
                      <ul>
                        {flattenMindNodes(map.children).map((topic) => (
                          <li key={topic.id}>
                            <button
                              className={`flow-outline__btn${isMindTopicSelected(topic.id) ? ' is-active' : ''}`}
                              onClick={() => onSelect?.({ kind: 'mind-node', mapId: map.id, ids: [topic.id] })}
                              type="button"
                            >
                              {topic.title}
                            </button>
                          </li>
                        ))}
                      </ul>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            {document.edges.length > 0 ? (
              <section className="flow-inspector__section">
                <h3>连线</h3>
                <ul className="flow-outline">
                  {document.edges.map((edge) => (
                    <li key={edge.id}>
                      <button
                        className={`flow-outline__btn${isEdgeSelected(edge.id) ? ' is-active' : ''}`}
                        onClick={() => onSelect?.({ kind: 'edge', ids: [edge.id] })}
                        type="button"
                      >
                        {edge.label || `${edge.from} → ${edge.to}`}
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </>
        ) : null}
      </div>
    </aside>
  );
}
