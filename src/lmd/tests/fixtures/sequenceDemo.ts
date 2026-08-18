/** Sequence-on-canvas fixture. Open with `?seq` to drop a draggable block on the stage. */
export const SEQUENCE_DEMO_MARKDOWN = `@project:"时序演示"[@comment:"参与者从消息端点自动列出，不用先声明节点。"]

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
