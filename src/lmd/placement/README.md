# 位置算法（`src/lmd/placement`）

画布上的节点、连线、组框、标签位置都从这里算。  
**改交互 / 改绘制时不要把几何写回 `engine.ts`。**

这是「能解耦就拆」的样板：纯几何在本目录，绘制在 `presentation/canvas/`。以后再发现可独立的算法，按同样方式拆，不要堆回大文件。

## 只做纯函数

- 输入：图数据、盒子、视口矩形
- 输出：坐标、折线、分栏、组框
- 禁止：DOM、Canvas、React、相机副作用

## 模块

| 文件 | 算法 | 不要轻易改的不变量 |
|------|------|-------------------|
| `edges.ts` | 三次贝塞尔路由、往返平行车道、标签贴线、视口夹取 | 往返边走上下两条近直线；标签沿线留在视口内并躲开组名 |
| `groups.ts` | 嵌套组外框 | 父组包住子组外框，不是所有后代节点的并集 |
| `content.ts` | 标题/描述分栏、视口内字号 | 按换行行数分栏；字号封顶设计值，缩小才跟着盒子收 |
| `lod.ts` | 缩放层级 | `< 0.28` 组内节点收进组；再小则从内向外收嵌套组；无组节点不省略 |
| `sequence.ts` | 时序块列/消息/激活柱 | 列名上下对称，生命线贯通 |
| `mind.ts` | 思维导图右向树 | 根在左，子节点按缩进向右展开 |

结构自动布局（节点坐标）在 `application/layout/structuralLayout.ts`，求解器在 `infrastructure/layout/`。换行量宽量高的字号模型在 `@lths/lmd` 的 `layoutNodeContent`。

## 怎么改

1. 只改 `placement/` 里对应文件
2. 跑 `npx --yes tsx src/lmd/tests/edgeRoute.test.ts`（以及 group / nodeContent / structural / layering）
3. 不要在 `presentation/canvas/` 复制一份算法
