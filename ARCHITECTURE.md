# 工程边界

## 运行时分层

```text
rules
  纯规则内核：状态、合法着法、成格、胜负、和棋
        |
game
  局面流程：回合、AI、悔棋、重开、终局流程
        |
input              presentation
  指针/键盘/控件      board / hud / fx / sfx
        \              /
          scheduler
      唯一管理动画帧
```

## 约束

- `rules.js` 不依赖 DOM、Canvas、音频或定时器。
- `ai.js` 只通过 `rules` 读取和模拟局面，不直接访问 UI。
- `input.js` 只把用户动作翻译成公开命令，不修改规则状态。
- `board.js` 只负责几何、命中测试和绘制，不驱动游戏流程。
- `fx.js` 只维护特效数据；特效是否绘制由 `board.js` 决定。
- `scheduler.js` 是唯一允许调用 `requestAnimationFrame` 的模块。
- `hud.js` 只把游戏状态投影到 DOM，不改变局面。
- 任何新增动画必须注册为已有状态源，不能在 `game.js` 增加新的帧循环。

## 动画契约

一个状态源必须满足：

```text
active(state, time) -> boolean
draw(state, time) -> void
```

没有活动状态源时调度器必须停止请求帧；状态变化、输入变化或特效开始时必须调用 `scheduler.wake()`。

## 联机演进

当前客户端仍是本地双人/本地 AI。未来联机时，规则内核可以直接复用到服务端：

```text
客户端输入 -> WebSocket 命令 -> 服务端 rules.applyMove
                         |
                         +-> 广播经过校验的状态/事件
```

客户端不能把自己的局面作为权威数据，也不能由客户端决定胜负。
