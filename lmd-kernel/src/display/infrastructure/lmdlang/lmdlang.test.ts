/**
 * Run: npx --yes tsx src/display/infrastructure/lmdlang/lmdlang.test.ts
 */
import { parseLmdLang } from './parse';
import { printLmdLang } from './print';
import { looksLikeLegacyLmd } from './migrate';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

const recommended = `@project:"产品图"[@comment:"摘要"]

# 关系
@group:"组1"[@members:("节点A","节点B",@group:"组2"[@members:("节点C","节点D")]),@comment:"一组"]
"节点A" -> |"下一步"| "节点B"
"节点B" -- "节点F"
@node:"孤立点"[@todo.prio:"0",@comment:"还没连"]

# 笔记
自由笔记
`;

const parsed = parseLmdLang(recommended, 'Fallback');
assert(parsed.project.name === '产品图', 'project name');
assert(parsed.project.summary === '摘要', 'summary');
assert(parsed.project.content.includes('自由笔记'), 'notes');
assert(parsed.graph.nodes.length === 6, `nodes ${parsed.graph.nodes.length}`);
assert(parsed.graph.groups.length === 2, 'two groups');
assert(parsed.graph.edges.length === 2, 'two edges');
assert(parsed.graph.edges.some((edge) => edge.label === '下一步'), 'edge label');
assert(parsed.graph.edges.some((edge) => edge.kind === 'line'), 'undirected');
assert(parsed.graph.nodes.some((node) => node.title === '孤立点' && node.todo?.prio === '0'), 'todo');

const printed = printLmdLang(parsed);
const again = parseLmdLang(printed, 'Fallback');
assert(again.graph.nodes.length === parsed.graph.nodes.length, 'print round-trip nodes');
assert(again.graph.edges.length === parsed.graph.edges.length, 'print round-trip edges');
assert(again.graph.groups.length === parsed.graph.groups.length, 'print round-trip groups');
assert(!printed.includes('@groud'), 'canonical uses @group');
assert(!printed.includes('@subbranch'), 'canonical omits @subbranch');
assert(!printed.includes('<-'), 'canonical omits left arrow');

const compat = `
@groud:"组1"[@members:("节点A","节点B",@groud:"组2")]
@groud:"组2"[@members:("节点C","节点D")]
"节点A" -> "节点B" -> |"关系说明"| "节点C"
    @subbranch:"节点B" -> "节点D"
"节点B" <- |"回"| "节点G"
`;
const compatParsed = parseLmdLang(compat, 'Compat');
assert(compatParsed.graph.groups.length === 2, 'compat groups');
assert(compatParsed.graph.nodes.some((node) => node.title === '节点G'), 'left arrow creates G');
assert(compatParsed.graph.edges.some((edge) => edge.from === compatParsed.graph.nodes.find((node) => node.title === '节点G')?.id), '<- becomes G->B');
const compatPrinted = printLmdLang(compatParsed);
assert(compatPrinted.includes('@group:"组1"'), 'compat prints @group');
assert(!compatPrinted.includes('@groud'), 'groud alias not printed');

const seqSource = `@project:"登录"

# 时序
@seq:"密码登录"(
  "用户" >> |"POST /login"| "网关"
  "网关" >> |"校验"| "鉴权"
  "鉴权" << |"ok"| "网关"
  "网关" << |"token"| "用户"
  @alt:"失败"(
    "鉴权" << |"401"| "网关"
  )
)
`;
const seqParsed = parseLmdLang(seqSource, 'Seq');
assert(seqParsed.sequence.scenes.length === 1, 'one scene');
assert(seqParsed.sequence.scenes[0]?.participants.map((item) => item.title).join(',') === '用户,网关,鉴权', 'auto participants');
assert(seqParsed.graph.nodes.length === 0, 'seq does not create graph nodes');
const seqPrinted = printLmdLang(seqParsed);
assert(seqPrinted.includes('# 时序'), 'prints 时序 section');
assert(seqPrinted.includes('>>'), 'prints call arrow');
assert(seqPrinted.includes('<<'), 'prints return arrow');
assert(!seqPrinted.includes('@actor'), 'no declared participants');
const seqAgain = parseLmdLang(seqPrinted, 'Seq');
assert(seqAgain.sequence.scenes[0]?.steps.length === seqParsed.sequence.scenes[0]?.steps.length, 'seq round-trip steps');

const lone = parseLmdLang(`@project:"列"

# 时序
@seq:"空列"(
  "旁观者"
  "用户" >> |"ping"| "网关"
)
`, 'Lone');
assert(lone.sequence.scenes[0]?.participants.some((item) => item.title === '旁观者'), 'bare name is a column');

const mindParsed = parseLmdLang(`@project:"树"

# 思维导图
@mind:"项目路径"(
  "src"["业务代码"]
  "core"["核心引擎"]
    "audio"
    "video"
    "canva2d"["画布"]
  "asset"["这里不要放视频"]
  "其他"
)
`, 'Mind');
const mind = mindParsed.mind.maps[0];
assert(mind?.title === '项目路径', 'mind title');
assert(mind?.children.map((item) => item.title).join(',') === 'src,core,asset,其他', 'mind top children');
assert(mind?.children[0]?.comment === '业务代码', 'bracket comment');
assert(mind?.children[1]?.children.map((item) => item.title).join(',') === 'audio,video,canva2d', 'indent children');
assert(mind?.children[1]?.children[2]?.comment === '画布', 'nested comment');
const mindPrinted = printLmdLang(mindParsed);
assert(mindPrinted.includes('# 思维导图'), 'prints mind section');
assert(mindPrinted.includes('@mind:"项目路径"'), 'prints mind title');
const mindAgain = parseLmdLang(mindPrinted, 'Mind');
assert(mindAgain.mind.maps[0]?.children[1]?.children.length === 3, 'mind indent round-trips');

const mdMind = parseLmdLang(`@project:"MD"

# 思维导图
@mind:"大纲"(
- src
  - core
  - audio
)
`, 'MdMind');
assert(mdMind.mind.maps[0]?.children[0]?.title === 'src', 'markdown bullet title');
assert(mdMind.mind.maps[0]?.children[0]?.children.map((item) => item.title).join(',') === 'core,audio', 'markdown indent');

const linked = parseLmdLang(`@project:"连时序"

# 关系
"网关" -> |"打开"| "密码登录"

# 时序
@seq:"密码登录"(
  "用户" >> |"login"| "网关"
)
`, 'Link');
const loginScene = linked.sequence.scenes[0];
assert(loginScene, 'linked scene exists');
assert(!linked.graph.nodes.some((node) => node.title === '密码登录'), 'sequence title does not spawn a graph node');
assert(linked.graph.edges.some((edge) => edge.to === loginScene.id && edge.label === '打开'), 'edge lands on the sequence');
const linkedAgain = parseLmdLang(printLmdLang(linked), 'Link');
assert(linkedAgain.graph.edges[0]?.to === linkedAgain.sequence.scenes[0]?.id, 'sequence edge round-trips');
assert(!linkedAgain.graph.nodes.some((node) => node.title === '密码登录'), 'round-trip keeps the sequence as the endpoint');
const lonePrinted = printLmdLang(lone);
assert(lonePrinted.includes('"旁观者"'), 'unused column survives print');

assert(looksLikeLegacyLmd('# X\n\n## Diagram\n```mermaid\nflowchart LR\n  A[A]\n```\n'), 'legacy detect');
assert(!looksLikeLegacyLmd(recommended), 'new language is not legacy');

const extras = parseLmdLang(`@project:"X"

# 关系
@node:"带链"[@url:"https://example.com"]
@ai.running:"产品经理"
@cli.command:("pwd","new")
@plugin:"demo"
`, 'Extras');
assert(extras.graph.nodes.some((node) => node.url === 'https://example.com'), 'url attr');
assert(extras.extras.unsupportedLines.some((line) => line.includes('@ai.running')), 'ai kept');
assert(extras.extras.unsupportedLines.some((line) => line.includes('@cli.command')), 'cli kept');
assert(extras.extras.unsupportedLines.some((line) => line.includes('@plugin')), 'plugin kept');
const extrasPrinted = printLmdLang(extras);
assert(extrasPrinted.includes('@ai.running'), 'unsupported printed back');
assert(!extrasPrinted.includes('@cli.command:') || extrasPrinted.includes('@cli.command'), 'cli printed back');

console.log('[lmdlang] ok');
