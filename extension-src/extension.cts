import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';

const VIEW_TYPE = 'lmdEditer.canvas';
const DEV_SERVER_URL = process.env.LMD_EDITER_WEBVIEW_DEV_SERVER?.trim() || '';

function createNonce() {
  return Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
}

function toRange(document: vscode.TextDocument) {
  return new vscode.Range(
    document.positionAt(0),
    document.positionAt(document.getText().length),
  );
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function mergeRanges(ranges: vscode.Range[]) {
  if (ranges.length === 0) {
    return null;
  }

  return ranges.reduce((accumulator, range) => new vscode.Range(
    accumulator.start.isBefore(range.start) ? accumulator.start : range.start,
    accumulator.end.isAfter(range.end) ? accumulator.end : range.end,
  ));
}

function findSectionRange(document: vscode.TextDocument, title: string) {
  const lines = document.getText().split(/\r?\n/);
  const headingPattern = new RegExp(`^##\\s+${escapeRegExp(title)}\\s*$`);
  const startLine = lines.findIndex((line) => headingPattern.test(line));
  if (startLine < 0) {
    return null;
  }

  let endLine = lines.length - 1;
  for (let index = startLine + 1; index < lines.length; index += 1) {
    if (/^##\s+/.test(lines[index])) {
      endLine = Math.max(startLine, index - 1);
      break;
    }
  }

  return new vscode.Range(
    new vscode.Position(startLine, 0),
    new vscode.Position(endLine, lines[endLine]?.length ?? 0),
  );
}

function findMermaidBlockLines(document: vscode.TextDocument) {
  const lines = document.getText().split(/\r?\n/);
  const startLine = lines.findIndex((line) => /^```mermaid\s*$/.test(line.trim()));
  if (startLine < 0) {
    return null;
  }

  for (let index = startLine + 1; index < lines.length; index += 1) {
    if (/^```\s*$/.test(lines[index].trim())) {
      return {
        startLine: startLine + 1,
        endLine: Math.max(startLine + 1, index - 1),
        lines,
      };
    }
  }

  return null;
}

function findNodeRanges(document: vscode.TextDocument, nodeIds: string[]) {
  const block = findMermaidBlockLines(document);
  if (!block) {
    return [];
  }

  return nodeIds.flatMap((nodeId) => {
    const pattern = new RegExp(`^\\s*${escapeRegExp(nodeId)}(?=\\s*[\\[\\(\\{])`);
    for (let index = block.startLine; index <= block.endLine; index += 1) {
      const line = block.lines[index] ?? '';
      if (!pattern.test(line)) {
        continue;
      }

      return [
        new vscode.Range(
          new vscode.Position(index, 0),
          new vscode.Position(index, line.length),
        ),
      ];
    }
    return [];
  });
}

function findSubgraphRanges(document: vscode.TextDocument, subgraphIds: string[]) {
  const block = findMermaidBlockLines(document);
  if (!block) {
    return [];
  }

  return subgraphIds.flatMap((subgraphId) => {
    const pattern = new RegExp(`^\\s*subgraph\\s+${escapeRegExp(subgraphId)}(?=\\s|\\[|$)`);
    for (let index = block.startLine; index <= block.endLine; index += 1) {
      const line = block.lines[index] ?? '';
      if (!pattern.test(line)) {
        continue;
      }

      return [
        new vscode.Range(
          new vscode.Position(index, 0),
          new vscode.Position(index, line.length),
        ),
      ];
    }
    return [];
  });
}

function findEdgeRanges(
  document: vscode.TextDocument,
  edges: Array<{ from: string; to: string; label?: string }>,
) {
  const block = findMermaidBlockLines(document);
  if (!block) {
    return [];
  }

  return edges.flatMap((edge) => {
    const fromPattern = new RegExp(`\\b${escapeRegExp(edge.from)}\\b`);
    const toPattern = new RegExp(`\\b${escapeRegExp(edge.to)}\\b`);
    for (let index = block.startLine; index <= block.endLine; index += 1) {
      const line = block.lines[index] ?? '';
      if (!fromPattern.test(line) || !toPattern.test(line) || !/(-->|-\.->|==>|---)/.test(line)) {
        continue;
      }

      if (edge.label && !line.includes(edge.label.split(/\r?\n/)[0])) {
        continue;
      }

      return [
        new vscode.Range(
          new vscode.Position(index, 0),
          new vscode.Position(index, line.length),
        ),
      ];
    }
    return [];
  });
}

function resolveSelectionRange(document: vscode.TextDocument, selection: unknown) {
  if (!selection || typeof selection !== 'object' || !('kind' in selection)) {
    return null;
  }

  const record = selection as Record<string, unknown>;
  if (record.kind === 'none') {
    return null;
  }

  if (record.kind === 'content') {
    return findSectionRange(document, 'Content');
  }

  if (record.kind === 'node' && Array.isArray(record.nodeIds)) {
    return mergeRanges(findNodeRanges(
      document,
      record.nodeIds.filter((item): item is string => typeof item === 'string'),
    ));
  }

  if (record.kind === 'subgraph' && Array.isArray(record.subgraphIds)) {
    return mergeRanges(findSubgraphRanges(
      document,
      record.subgraphIds.filter((item): item is string => typeof item === 'string'),
    ));
  }

  if (record.kind === 'edge' && Array.isArray(record.edges)) {
    return mergeRanges(findEdgeRanges(
      document,
      record.edges.flatMap((edge) => {
        if (!edge || typeof edge !== 'object') {
          return [];
        }
        const edgeRecord = edge as Record<string, unknown>;
        if (typeof edgeRecord.from !== 'string' || typeof edgeRecord.to !== 'string') {
          return [];
        }
        return [{
          from: edgeRecord.from,
          to: edgeRecord.to,
          label: typeof edgeRecord.label === 'string' ? edgeRecord.label : undefined,
        }];
      }),
    ));
  }

  return null;
}

async function revealRangeInVisibleTextEditor(document: vscode.TextDocument, range: vscode.Range) {
  const editor = vscode.window.visibleTextEditors.find((entry) => entry.document.uri.toString() === document.uri.toString());
  if (!editor) {
    return;
  }

  editor.selection = new vscode.Selection(range.start, range.end);
  editor.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
}

class LmdEditorProvider implements vscode.CustomTextEditorProvider {
  constructor(private readonly context: vscode.ExtensionContext) {}

  async resolveCustomTextEditor(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel,
  ): Promise<void> {
    let lastSelectionRange: vscode.Range | null = null;

    webviewPanel.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'dist')],
    };

    webviewPanel.webview.html = DEV_SERVER_URL
      ? this.getDevWebviewHtml(document)
      : await this.getWebviewHtml(webviewPanel.webview, document);

    const pushDocument = () => {
      webviewPanel.webview.postMessage({
        type: 'lmd/document',
        markdown: document.getText(),
        fileName: path.basename(document.uri.fsPath),
      });
    };

    const changeSubscription = vscode.workspace.onDidChangeTextDocument((event) => {
      if (event.document.uri.toString() !== document.uri.toString()) {
        return;
      }

      pushDocument();
    });

    webviewPanel.onDidDispose(() => {
      changeSubscription.dispose();
    });

    webviewPanel.webview.onDidReceiveMessage(async (message) => {
      if (!message || typeof message !== 'object' || !('type' in message)) {
        return;
      }

      if (message.type === 'lmd/ready') {
        pushDocument();
        return;
      }

      if (message.type === 'lmd/updateDocument' && 'markdown' in message && typeof message.markdown === 'string') {
        const nextMarkdown = message.markdown;
        if (nextMarkdown === document.getText()) {
          return;
        }

        const edit = new vscode.WorkspaceEdit();
        edit.replace(document.uri, toRange(document), nextMarkdown);
        await vscode.workspace.applyEdit(edit);
        return;
      }

      if (message.type === 'lmd/openSource') {
        if ('selection' in message) {
          lastSelectionRange = resolveSelectionRange(document, message.selection);
        }
        await vscode.window.showTextDocument(document, {
          preview: false,
          selection: lastSelectionRange ?? undefined,
        });
        return;
      }

      if (message.type === 'lmd/revealSelection' && 'selection' in message) {
        lastSelectionRange = resolveSelectionRange(document, message.selection);
        if (lastSelectionRange) {
          await revealRangeInVisibleTextEditor(document, lastSelectionRange);
        }
      }
    });
  }

  private async getWebviewHtml(webview: vscode.Webview, document: vscode.TextDocument) {
    const distPath = vscode.Uri.joinPath(this.context.extensionUri, 'dist');
    const indexUri = vscode.Uri.joinPath(distPath, 'index.html');

    let html: string;
    try {
      html = await fs.readFile(indexUri.fsPath, 'utf8');
    } catch {
      return this.getMissingBuildHtml(webview);
    }

    const nonce = createNonce();
    const config = JSON.stringify({
      platform: 'vscode',
      initialMarkdown: document.getText(),
      fileName: path.basename(document.uri.fsPath),
    });

    html = html.replace(
      /(src|href)="\.\/([^"]+)"/g,
      (_, attr: string, relativePath: string) => {
        const resourceUri = webview.asWebviewUri(vscode.Uri.joinPath(distPath, ...relativePath.split('/')));
        return `${attr}="${resourceUri.toString()}"`;
      },
    );

    html = html.replace(
      '</head>',
      [
        `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data: blob:; style-src ${webview.cspSource} 'unsafe-inline'; font-src ${webview.cspSource} data:; script-src 'nonce-${nonce}'; connect-src https:;">`,
        `<script nonce="${nonce}">window.__LMD_EDITOR_CONFIG__=${config};</script>`,
        '</head>',
      ].join(''),
    );

    html = html.replace(/<script type="module"/g, `<script nonce="${nonce}" type="module"`);
    return html;
  }

  private getDevWebviewHtml(document: vscode.TextDocument) {
    const nonce = createNonce();
    const config = JSON.stringify({
      platform: 'vscode',
      initialMarkdown: document.getText(),
      fileName: path.basename(document.uri.fsPath),
    });
    const baseUrl = DEV_SERVER_URL.replace(/\/+$/, '');

    return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${baseUrl} data: blob:; style-src 'unsafe-inline' ${baseUrl}; font-src ${baseUrl} data:; script-src 'nonce-${nonce}' ${baseUrl}; connect-src ${baseUrl} ws://127.0.0.1:* ws://localhost:* http://127.0.0.1:* http://localhost:* https:;">
    <script nonce="${nonce}">window.__LMD_EDITOR_CONFIG__=${config};</script>
    <title>LMD_EDITER</title>
  </head>
  <body>
    <div id="root"></div>
    <script nonce="${nonce}" type="module" src="${baseUrl}/@vite/client"></script>
    <script nonce="${nonce}" type="module" src="${baseUrl}/src/main.tsx"></script>
  </body>
</html>`;
  }

  private getMissingBuildHtml(webview: vscode.Webview) {
    const nonce = createNonce();
    return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';" />
    <title>LMD_EDITER</title>
    <style>
      body {
        margin: 0;
        padding: 24px;
        background: #191919;
        color: #ebebeb;
        font: 13px/1.5 -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      }
      .card {
        max-width: 680px;
        margin: 0 auto;
        padding: 20px;
        border: 1px solid rgba(255,255,255,0.08);
        border-radius: 12px;
        background: #202020;
      }
      h1 { margin: 0 0 12px; font-size: 22px; }
      p { margin: 0 0 10px; color: #b3b3b1; }
      code {
        padding: 2px 6px;
        border-radius: 6px;
        background: rgba(255,255,255,0.05);
      }
    </style>
  </head>
  <body>
    <div class="card">
      <h1>LMD_EDITER 未找到 webview 构建产物</h1>
      <p>请先在这个项目目录执行 <code>pnpm run build:vscode</code>，再重新加载扩展。</p>
      <p>该命令会同时生成 React 画布 webview 和 VSCode 扩展入口。</p>
    </div>
  </body>
</html>`;
  }
}

export function activate(context: vscode.ExtensionContext) {
  const provider = new LmdEditorProvider(context);

  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(VIEW_TYPE, provider, {
      webviewOptions: {
        retainContextWhenHidden: true,
      },
      supportsMultipleEditorsPerDocument: false,
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('lmdEditer.openWithCanvas', async (resource?: vscode.Uri) => {
      const target = resource ?? vscode.window.activeTextEditor?.document.uri;
      if (!target) {
        return;
      }

      await vscode.commands.executeCommand('vscode.openWith', target, VIEW_TYPE);
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('lmdEditer.openTextSource', async (resource?: vscode.Uri) => {
      const target = resource ?? vscode.window.activeTextEditor?.document.uri;
      if (!target) {
        return;
      }

      const document = await vscode.workspace.openTextDocument(target);
      await vscode.window.showTextDocument(document, {
        preview: false,
      });
    }),
  );
}

export function deactivate() {}
