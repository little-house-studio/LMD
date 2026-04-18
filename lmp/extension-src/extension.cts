import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';

const VIEW_TYPE = 'lmpEditer.canvas';
const DEV_SERVER_URL = process.env.LMP_EDITER_WEBVIEW_DEV_SERVER?.trim() || '';

function createNonce() {
  return Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
}

function toRange(document: vscode.TextDocument) {
  return new vscode.Range(
    document.positionAt(0),
    document.positionAt(document.getText().length),
  );
}

class LmpEditorProvider implements vscode.CustomTextEditorProvider {
  constructor(private readonly context: vscode.ExtensionContext) {}

  async resolveCustomTextEditor(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel,
  ): Promise<void> {
    webviewPanel.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'dist')],
    };

    webviewPanel.webview.html = DEV_SERVER_URL
      ? this.getDevWebviewHtml(document)
      : await this.getWebviewHtml(webviewPanel.webview, document);

    const pushDocument = () => {
      webviewPanel.webview.postMessage({
        type: 'lmp/document',
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

      if (message.type === 'lmp/ready') {
        pushDocument();
        return;
      }

      if (message.type === 'lmp/updateDocument' && 'markdown' in message && typeof message.markdown === 'string') {
        const nextMarkdown = message.markdown;
        if (nextMarkdown === document.getText()) {
          return;
        }

        const edit = new vscode.WorkspaceEdit();
        edit.replace(document.uri, toRange(document), nextMarkdown);
        await vscode.workspace.applyEdit(edit);
        return;
      }

      if (message.type === 'lmp/openSource') {
        const target = document.uri;
        const textDocument = await vscode.workspace.openTextDocument(target);
        await vscode.window.showTextDocument(textDocument, {
          preview: false,
        });
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
        `<script nonce="${nonce}">window.__LMP_EDITOR_CONFIG__=${config};</script>`,
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
    <script nonce="${nonce}">window.__LMP_EDITOR_CONFIG__=${config};</script>
    <title>LMP_EDITER</title>
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
    <title>LMP_EDITER</title>
    <style>
      body {
        margin: 0;
        padding: 24px;
        background: #14110f;
        color: #f7efe6;
        font: 13px/1.5 -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      }
      .card {
        max-width: 680px;
        margin: 0 auto;
        padding: 20px;
        border: 1px solid rgba(255,255,255,0.08);
        border-radius: 18px;
        background: #211b18;
      }
      h1 { margin: 0 0 12px; font-size: 22px; }
      p { margin: 0 0 10px; color: #d8c1aa; }
      code {
        padding: 2px 6px;
        border-radius: 6px;
        background: rgba(255,255,255,0.06);
      }
    </style>
  </head>
  <body>
    <div class="card">
      <h1>LMP_EDITER did not find the webview build output</h1>
      <p>Run <code>pnpm run build:vscode</code> inside the <code>lmp</code> directory, then reload the extension.</p>
    </div>
  </body>
</html>`;
  }
}

export function activate(context: vscode.ExtensionContext) {
  const provider = new LmpEditorProvider(context);

  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(VIEW_TYPE, provider, {
      webviewOptions: {
        retainContextWhenHidden: true,
      },
      supportsMultipleEditorsPerDocument: false,
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('lmpEditer.openWithCanvas', async (resource?: vscode.Uri) => {
      const target = resource ?? vscode.window.activeTextEditor?.document.uri;
      if (!target) {
        return;
      }
      await vscode.commands.executeCommand('vscode.openWith', target, VIEW_TYPE);
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('lmpEditer.openTextSource', async (resource?: vscode.Uri) => {
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
