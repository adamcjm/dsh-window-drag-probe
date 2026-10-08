# dsh-window-drag-probe

[English](README.md) | 中文

一个 [DSH](https://github.com/deepseek-ai/deepseek-harness) 插件：在 macOS 上恢复 DSH Desktop 的窗口拖动能力，并**从运行中的窗口内部**诊断它为什么拖不动。

上游报告：**[deepseek-ai/deepseek-harness discussion #9112](https://github.com/deepseek-ai/deepseek-harness/discussions/9112)**

---

## 为什么需要它

macOS 上的 DSH Desktop 是 `hiddenInset` 窗口，**没有原生标题栏**，因此窗口拖动完全依赖页面声明的 `-webkit-app-region: drag` 盒子。外壳用 `data-window-drag` 标记自己的 chrome 行，`ui-web` 的 `base.css` 把这个标记变成唯一一条 drag 规则。

但实际运行中这些行**拖不动**：同一张样式表里的 interactive `no-drag` 选择器在真实 DOM 里命中成千上万个盒子（按钮、`[tabindex]` 聚焦容器、带 ARIA role 的控件），只要其中有任何一个与某条 chrome 行重叠、且在**文档顺序上更靠后**，就会把重叠区减掉。chrome 行剩下的可拖区域只有几个像素高，于是「哪里看起来像标题栏就在哪里按」全都没有反应。

本插件**不修改任何官方文件**，只做两件事：

1. **一条 16 px 的顶部拖拽带**：用内联 `app-region: drag` **追加到 `document.body` 末尾** —— Electron 的合成按文档顺序决定胜负，放在最后才不会被更早的 `no-drag` 盒子减掉。
2. **一个诊断面板**：在真实窗口里读回证据 —— 平台标记、chrome 行的 computed `app-region`、recall 标记、全部 app-region 盒子、可拖性矩阵，以及从 `window.screenX/screenY` 读到的窗口位移。

---

## 安装

### 方式 A：从插件页安装（DSH Desktop 推荐）

DSH Desktop 的 profile 由应用独占管理，命令行会被拒绝，所以走界面：

1. 侧边栏 → **插件** → **Add plugin** → 打开箭头菜单 → **安装第三方插件**
2. 粘贴仓库地址：

   ```
   https://github.com/adamcjm/dsh-window-drag-probe
   ```

3. 安装，然后选择 **立即启用**（Enable now）
4. **用 ⌘Q 完全退出 DSH Desktop 再重新打开** —— 客户端 bundle 只在宿主 boot 时组装一次，关窗口不算重启

### 方式 B：命令行（由命令行管理的 profile）

```sh
dsh plugin --profile <profile> add https://github.com/adamcjm/dsh-window-drag-probe
```

然后重启该宿主。

### 方式 C：本地目录（开发用）

```sh
git clone https://github.com/adamcjm/dsh-window-drag-probe
dsh plugin --profile <profile> add "$PWD/dsh-window-drag-probe"
```

本地目录安装是**链接**而非拷贝，改完源码在下次宿主重启后生效。

---

## 使用说明

### 拖拽带

宿主重启后，窗口**最顶部 16 px** 会出现一条淡蓝色带子。在里面任意位置按住拖动，窗口就会跟着走。

- 带子刻意做成可见：可拖拽区域会吞掉指针事件，做不了 hover 提示，而不可见的带子等于不可用。
- 带子下方的一切照常工作，它不会拦截自己 16 px 之外的点击。
- 每个窗口只有一条带子，重复装载是幂等的。

### 诊断面板

插件页 → 点开 **窗口拖动** → 按 **打开「窗口拖动」面板**（这个按钮由插件注册在自己的插件页上）。

面板可用标题条拖动、用 `▾` 折叠、会记住位置，并报告：

> 面板与按钮的文案跟随 DSH 的语言：中文界面显示中文，切到 English 即显示英文（面板开着也会即时重贴文案）。插件列表里的名字与描述同样跟随语言（`locale/zh.json` → 窗口拖动，`locale/en.json` → Window Drag）。

| 行 | 含义 |
| --- | --- |
| `platform` | `data-platform` 标记。只有 `darwin` 下才存在 drag 规则。 |
| `computed app-region · body / 首个 drag 行` | 原始 computed 值。行上显示 `drag` 说明级联没问题，损失发生在合成阶段。 |
| `recall 标记当前` | 外壳的 `data-window-drag-recall` 脉冲是否常驻。常驻会把整个拖拽面减掉。 |
| `窗口位置` / `窗口移动记录` | 实时的 `window.screenX/screenY` —— 页面内唯一能见证原生窗口位移的东西。 |
| `drag 行` | 每个 `[data-window-drag]` 元素及其盒子与 computed 值。 |
| `app-region 盒子` | 所有 computed `app-region` 不为 `none` 的盒子，按文档顺序。 |
| `顶部可拖性矩阵` | 顶部区域的 `■`/`·` 矩阵，按项目自身的模型判定（文档顺序里最后一个包含该点的盒子决定）。 |
| `采样点命中链` | 每个采样点被哪些盒子包含、最终由谁决定。 |

面板按钮：**重新采集**、**插入 / 移除顶部拖拽带**、**复位位置**、**隐藏面板**。

---

## 卸载

- **插件页**：点开插件卡片 → **卸载**。
- **命令行**：`dsh plugin --profile <profile> remove dsh-window-drag-probe`
- **手动安装的**：从 profile 的 `node_modules` 删除 `dsh-window-drag-probe` 软链，再用备份恢复 `package.json` / `cordis.patch.yml`。

卸载后拖拽带消失，重启后窗口回到原来（拖不动）的状态。

---

## 验证环境

| | |
| --- | --- |
| DSH Desktop | 0.2.0-rc.2 |
| Electron | 44.0.0 |
| macOS | 27.0.1（26A434，Apple Silicon） |

带子是无条件装载的，但它所补偿的 app-region 规则只在 `html[data-platform='darwin']` 下存在。其他平台上插件仍会加载、面板仍会报告，`platform` 一行会显示实际标记。

## 已知限制

- 这是**临时规避 + 探针**，不是上游修复。如果矩阵显示某点 `drag` 却依然拖不动，说明原因在页面之外，只能等上游修复（见讨论串）。
- 插件只往 `document.body` 追加一个 `div`、往插件页注册一个按钮；它只读 DOM 状态与 `screenX/screenY`，不向任何地方发送数据。
- 面板刻意用原生 DOM 浮层而不是 slot 装饰：它需要能在整个视口上自由定位，而拖拽带必须位于文档顺序最后。

## 许可证

MIT
