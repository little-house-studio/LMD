"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
const fs = __importStar(require("node:fs/promises"));
const path = __importStar(require("node:path"));
const vscode = __importStar(require("vscode"));
const VIEW_TYPE = 'lmdEditer.canvas';
function createNonce() {
    return Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
}
function toRange(document) {
    return new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length));
}
class LmdEditorProvider {
    context;
    constructor(context) {
        this.context = context;
    }
    async resolveCustomTextEditor(document, webviewPanel) {
        webviewPanel.webview.options = {
            enableScripts: true,
            localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'dist')],
        };
        webviewPanel.webview.html = await this.getWebviewHtml(webviewPanel.webview, document);
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
                await vscode.commands.executeCommand('vscode.openWith', document.uri, 'default');
            }
        });
    }
    async getWebviewHtml(webview, document) {
        const distPath = vscode.Uri.joinPath(this.context.extensionUri, 'dist');
        const indexUri = vscode.Uri.joinPath(distPath, 'index.html');
        let html;
        try {
            html = await fs.readFile(indexUri.fsPath, 'utf8');
        }
        catch {
            return this.getMissingBuildHtml(webview);
        }
        const nonce = createNonce();
        const config = JSON.stringify({
            platform: 'vscode',
            initialMarkdown: document.getText(),
            fileName: path.basename(document.uri.fsPath),
        });
        html = html.replace(/(src|href)="\.\/([^"]+)"/g, (_, attr, relativePath) => {
            const resourceUri = webview.asWebviewUri(vscode.Uri.joinPath(distPath, ...relativePath.split('/')));
            return `${attr}="${resourceUri.toString()}"`;
        });
        html = html.replace('</head>', [
            `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data: blob:; style-src ${webview.cspSource} 'unsafe-inline'; font-src ${webview.cspSource} data:; script-src 'nonce-${nonce}'; connect-src https:;">`,
            `<script nonce="${nonce}">window.__LMD_EDITOR_CONFIG__=${config};</script>`,
            '</head>',
        ].join(''));
        html = html.replace(/<script type="module"/g, `<script nonce="${nonce}" type="module"`);
        return html;
    }
    getMissingBuildHtml(webview) {
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
function activate(context) {
    const provider = new LmdEditorProvider(context);
    context.subscriptions.push(vscode.window.registerCustomEditorProvider(VIEW_TYPE, provider, {
        webviewOptions: {
            retainContextWhenHidden: true,
        },
        supportsMultipleEditorsPerDocument: false,
    }));
    context.subscriptions.push(vscode.commands.registerCommand('lmdEditer.openWithCanvas', async (resource) => {
        const target = resource ?? vscode.window.activeTextEditor?.document.uri;
        if (!target) {
            return;
        }
        await vscode.commands.executeCommand('vscode.openWith', target, VIEW_TYPE);
    }));
    context.subscriptions.push(vscode.commands.registerCommand('lmdEditer.openTextSource', async (resource) => {
        const target = resource ?? vscode.window.activeTextEditor?.document.uri;
        if (!target) {
            return;
        }
        await vscode.commands.executeCommand('vscode.openWith', target, 'default');
    }));
}
function deactivate() { }
