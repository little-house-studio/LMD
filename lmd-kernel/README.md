# `@lths/lmd`

LMD 协议内核。编辑器、CLI、插件和外部 Agent 都应依赖这里，而不是直接改 `GraphDocument`。

```ts
import { createSession, COMMAND_CATALOG } from '@lths/lmd';

const session = createSession(source);
session.apply({ op: 'node.create', title: '接口层' });
const diagnostics = session.check();
const text = session.print(); // instruction language
const mermaid = session.printMermaid();
const meta = session.printMeta(); // sibling .lths JSON
```

```bash
pnpm --dir lmd-kernel test
pnpm --dir lmd-kernel cli check path/to/file.lmd
pnpm --dir lmd-kernel cli catalog
```

子路径：`/spec` `/ir` `/parse` `/diagnostics` `/commands` `/layout` `/runtime` `/plugin` `/adapters` `/sdk` `/legacy`。

架构见 [ARCHITECTURE.md](./ARCHITECTURE.md)。文件格式约定仍以仓库 `skills/lmd-protocol/` 为准。
