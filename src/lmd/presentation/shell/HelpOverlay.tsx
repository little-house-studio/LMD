import type { CanvasPolicy } from '../../domain/canvasPolicy';

type HelpOverlayProps = {
  policy: CanvasPolicy;
  onClose: () => void;
};

export function HelpOverlay({ policy, onClose }: HelpOverlayProps) {
  return (
    <div className="flow-help-scrim" onClick={onClose} role="presentation">
      <div
        className="stage-help"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-label="交互说明"
      >
        <button className="stage-help__close" onClick={onClose} type="button">
          ✕
        </button>
        <h4>LMD 交互说明</h4>
        <ul>
          <li>点节点会在旁边弹出不遮挡的工具条；底栏节点按钮也可打开。N 开关 · V 选择 · H 平移</li>
          <li>拖拽节点 / 分组，位置按网格吸附；空白拖出框选；Shift 框选追加</li>
          <li>整理按拓扑重排（嵌套组紧凑块），然后仍可自由拖开</li>
          <li>触控板双指滑动平移；捏合或 ⌃/⌘+滚轮缩放</li>
          <li>中键 / 空格拖 = 平移；Shift+滚轮横向平移</li>
          <li>Shift / ⌘ 点击加减选；Alt 拖节点 = 复制并拖走</li>
          <li>选中后拖端口连线；右键拖节点、时序块或思维导图连线；时序/导图可当单个节点接入；⌘/⌃ 连出虚线；拖到空白 = 新建并连接</li>
          <li>⌘/⌃ 拖到分组上 = 编入该组；拖到连线上 = 插入节点；拖到空白 = 移出分组</li>
          <li>箭头键微调（16px）；Shift+箭头按网格格点移动</li>
          <li>Tab 建并连接子节点；Shift+Tab 镜像；空格建同级</li>
          <li>Enter / 双击就地改内容（点标题改标题，点描述改描述）；编辑中 Tab 切换；⌘F 查找</li>
          <li>双击空白 = 在该处新建并编辑标题；点分组 ▾ 折叠，双击标题改组名</li>
          <li>Del 删除；⌘A / Ctrl+A 全选节点、分组、时序、导图等；框选可同时圈到时序块和思维导图；⌘C/V 复制粘贴；⌘D 再制；⌘G 分组</li>
          <li>Q 建时序块。块内：双击列名/消息改文字；双击空白在该处加列（柱）；拖列排序；拖消息上下改时间顺序；空白按住左键框选；拖标题栏挪整块；在竖线上按住右键拖到目标激活柱画方向连线（向左=返回，Alt 也是返回）；左键从生命线拖到另一列也可画消息；右上角 + 加列；Del 删选中项</li>
          <li>W 建思维导图。源码用缩进树或 Markdown 列表；点主题选中；双击改名；双击空白加子主题；右上角 + 加主题；拖标题栏挪整块；选中后拖端口或右键从块连到节点；Del 删选中项</li>
          <li>⌘+ / ⌘- / ⌘0 缩放；⌘Z / ⌘⇧Z 撤销重做；⌘S 保存；⌘/ 本说明</li>
          {policy.tools.frames ? (
            <li>形状框：点「框」后拖出区域；Esc 退出该模式</li>
          ) : null}
        </ul>
      </div>
    </div>
  );
}
