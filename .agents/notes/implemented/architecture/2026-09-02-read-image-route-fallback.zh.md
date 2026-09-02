# Agent Note：`read_image` 路由回退接缝

状态：已实现（PR #79，issue #54 —— 等待线上确认）

[English](2026-09-02-read-image-route-fallback.md) | 中文

## 问题

当会话模型未声明图像输入时，`@deepseek-ai/dsh-tool-fs` 会拒绝 `read_image`。在 Parametria harness 上，会话模型常为纯文本，而机器级已注册了具备图像能力的路由（`parametria-vision`），因此除非外部描述工具（modlens）恰好可用，否则每次读图都会被硬性拒绝。

## 决定

本分支携带根级 Yarn 补丁 `patches/dsh-tool-fs@0.1.1-rc.2.patch`，把 `assertImageCapableRoute` 中的精确模态门槛改造成一个接缝：当调用路由未通过门槛后，工具发出 `fs/read-image-route` waterfall；若某监听者返回一个通过同一模态检查的图像能力候选路由，则仅在图像被持久化接纳之后才激活它。没有监听者时抛出原始拒绝，因此兼容模式组合保持惰性。

桌面插件 `dsh-plugin-desktop/parametria-read-image-fallback` 仅在 Parametria 预设中应答该 waterfall：它指定与 `subagent_validator` 相同的路由和模型（由预设漂移围栏保持一致），让当前回合的其余请求留在该路由上，在下一回合恢复原路由时把历史中的图像块投影为稳定文本，并在 `agent/disposed` 时释放其按 agent 保存的状态。

## 后果

- `fs/` 事件命名空间归上游所有；`fs/read-image-route` 为分支自创，可能与未来的上游事件冲突。每次 pin 升级都要重新验证该补丁（`.engineering/upstream-watch.md` 的 RE-VALIDATE 表）。
- 回退回合的其余部分按视觉提供商计费，原提供商的缓存复用丢失，且回退路由上省略 `reasoningEffort`。这已在预设行注释中披露。
- 待线上数据确认行为后，可作为向 `deepseek-harness` 上游贡献的候选（在此之前 issue #54 保持打开）。
