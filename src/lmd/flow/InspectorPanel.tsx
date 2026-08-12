import type { GraphDocument } from '..';
import type { StageSelection } from '../stage/engine';
import { splitEntityText } from './label';
import { edgeTypeOptions, nodeStylePresets, shapeOptions } from './presets';

type InspectorPanelProps = {
  document: GraphDocument;
  selection: StageSelection;
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
  /** Outline click → select + focus on canvas. */
  onSelect?: (selection: StageSelection) => void;
};

export function InspectorPanel({
  document,
  selection,
  onPatchNode,
  onPatchEdge,
  onPatchGroup,
  onPatchProject,
  onSelect,
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

  const isNodeSelected = (id: string) =>
    selection.kind === 'node' && selection.ids.includes(id);
  const isGroupSelected = (id: string) =>
    selection.kind === 'group' && selection.ids.includes(id);
  const isEdgeSelected = (id: string) =>
    selection.kind === 'edge' && selection.ids.includes(id);

  return (
    <aside className="flow-inspector">
      <div className="flow-inspector__head">属性</div>
      <div className="flow-inspector__scroll">
        <section className="flow-inspector__section">
          <h3>工程</h3>
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
              rows={2}
              value={document.projectSummary || ''}
            />
          </label>
          <label className="flow-field">
            <span>附加信息 Content</span>
            <textarea
              onChange={(event) => onPatchProject({ contentMarkdown: event.target.value })}
              rows={5}
              value={document.contentMarkdown || ''}
            />
          </label>
        </section>

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
            <div className="flow-field-hint">
              双击分组可折叠 / 展开子节点
            </div>
          </section>
        ) : null}

        {selection.kind !== 'none' && !primaryNode && !primaryEdge && !primaryGroup ? (
          <section className="flow-inspector__section">
            <h3>多选</h3>
            <p className="flow-field-hint">
              已选 {selection.ids.length} 项（{selection.kind}）。可使用工具栏删除 / 分组 / 复制 / 连线。
            </p>
          </section>
        ) : null}

        {selection.kind === 'none' ? (
          <section className="flow-inspector__section">
            <p className="flow-field-hint">选中节点、连线或分组以编辑属性。</p>
          </section>
        ) : null}

        <section className="flow-inspector__section">
          <h3>图谱大纲</h3>
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

        {document.edges.length > 0 ? (
          <section className="flow-inspector__section">
            <h3>连线列表</h3>
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
      </div>
    </aside>
  );
}
