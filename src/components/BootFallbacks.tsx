import { Component } from 'react';
import type { ReactNode } from 'react';

interface RootErrorBoundaryProps {
  children: ReactNode;
}

interface RootErrorBoundaryState {
  error: Error | null;
}

export class RootErrorBoundary extends Component<
  RootErrorBoundaryProps,
  RootErrorBoundaryState
> {
  state: RootErrorBoundaryState = {
    error: null,
  };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div className="diagnostic-shell">
          <div className="diagnostic-card">
            <p className="eyebrow">运行时错误</p>
            <h1>编辑器在主界面绘制前发生异常</h1>
            <p>
              根应用抛出了异常。这个兜底页刻意保持极简，这样即使主程序失败，也还能把错误状态显示出来。
            </p>
            <pre className="diagnostic-code">{this.state.error.message}</pre>
            <div className="diagnostic-actions">
              <a className="solid-button" href="?safe=1">
                打开安全模式
              </a>
              <a className="ghost-button" href="?reset=1">
                重置本地工作区
              </a>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export function DiagnosticShell() {
  return (
    <div className="diagnostic-shell">
      <div className="diagnostic-card">
        <p className="eyebrow">安全模式</p>
        <h1>最小壳层已正常运行</h1>
        <p>
          这个页面会完全跳过编辑器启动链路。如果这里能秒开，而主编辑器会卡住，就说明问题在编辑器运行时，而不是基础的 React/Vite 壳层。
        </p>

        <div className="diagnostic-grid">
          <div>
            <strong>检查 1</strong>
            <span>这个页面能否立即显示？</span>
          </div>
          <div>
            <strong>检查 2</strong>
            <span>重置本地状态后，能否正常打开主应用？</span>
          </div>
        </div>

        <div className="diagnostic-actions">
          <a className="solid-button" href="./">
            打开完整编辑器
          </a>
          <a className="ghost-button" href="?reset=1">
            重置本地工作区
          </a>
          <a className="ghost-button" href="?reset=1&safe=1">
            安全模式 + 重置
          </a>
        </div>
      </div>
    </div>
  );
}
