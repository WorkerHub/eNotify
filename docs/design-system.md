# eNotify 设计契约（Design Contract v1.0）

> 状态：冻结。本文件是 ONE-68 的交付物，是后续实现子单（令牌与基础组件 → 页面级重构 → 动效与响应式）的唯一契约依据。
> 本文只定义规格，不含实现代码。令牌的唯一写入位置是 `web/src/index.css` 的 `@theme inline` 块，`.dark` 块维护同名 token。

## 0. 审计方法与证据

- 环境：本地 `pnpm dev`（Vite 8 + wrangler dev），实机注册 admin 账号、建库、播种 6 条订阅/重置型条目，覆盖「有数据」与「空骨架」两种状态。
- 覆盖：19 个页面 + AppLayout，桌面（1440×900）与移动（390×844）两种视口，明暗两套主题，共 71 张截图（审计时存档，随交付评论抽样附上）。
- 所有「文件:行号」均对照本仓库当前 HEAD。

### 代码侧关键证据（先于打分）

| 证据 | 位置 |
|---|---|
| 设计令牌只有颜色与圆角两组，无字体/字号/行高/字重/字距/间距/阴影/缓动/时长任何 token | `web/src/index.css:4-30` |
| `body` 未声明 `font-family`，全站走浏览器默认系统栈 | `web/src/index.css:78-84` |
| 字号使用：`text-sm` 252 处、`text-xs` 145 处、`text-2xl` 14、`text-base` 9、`text-xl` 7、`text-lg` 3 —— 正文层级几乎只有 sm/xs 两档，标题层级塌陷 | 全仓 grep 统计 |
| `tracking-*` 全站仅 9 处、`leading-*` 仅 6 处；`tabular-nums` 仅 5 处（日期/倒计时大量数字未用等宽数字） | 全仓 grep 统计 |
| 阴影只有 `shadow-sm`（4 处）与 `shadow-lg`（20 处）两档，`shadow-lg` 被滥用于下拉菜单、弹层等所有浮层 | 全仓 grep 统计 |
| 全站 `duration-*` / `ease-*` **0 处**；所有过渡都是 `transition-colors` 默认值（150ms / cubic-bezier(0.4,0,0.2,1)） | 全仓 grep 统计 |
| 移动端「通知列表」把表格 7 列（名称/分类/模式/到期日/状态/提醒/操作）塞进卡片，单行 5 个操作按钮（编辑/停用/测试/重置/删除）挤在一排 | 截图 `items-mobile-light.png`；`ItemListPage.tsx`（40.4K） |
| 加载态全站用 `animate-pulse` 灰块占位（无骨架组件、无 stagger、无内容形态匹配） | `DashboardPage.tsx`、`SettingsPage.tsx:595,821`、`AdminUsersPage.tsx:215,365-369`、`AdminAppPage.tsx:55`、`AdminEmailPage.tsx:165`、`AdminSecurityPage.tsx:131` |
| 桌面端首屏骨架是 4 张等宽灰卡 + 一个灰块，与最终内容形态（统计条 + 时间线）完全不符，加载前后布局跳动 | 截图 `dashboard-desktop-light.png` / `dashboard-desktop-dark.png` |
| 详情页表单字段（名称/模式/分类/开始日期/周期/到期日/提前提醒/开关×2/日历模式/备注/渠道）全部单栏纵向堆叠，无分组、无分区标题，桌面 1440px 下表单挤在中栏、两侧大片空白 | 截图 `item-detail-desktop-light.png`；`ItemDetailPage.tsx`（46.9K） |
| 明暗主题仅替换色值，阴影/边框/层级关系在暗色下仍用浅色逻辑（`shadow-lg` 在纯黑背景上失效） | `index.css:54-73`（`.dark` 块无阴影定义） |

---

## 1. 八维度现状打分（0-10）

| 维度 | 分数 | 证据与问题描述 |
|---|---|---|
| typography | **2/10** | `body` 无 font-family（`index.css:78`）；无字号阶梯 token；`text-sm`/`text-xs` 占全部字号使用的 86%（397/449），标题仅用 `text-xl font-bold`（AppLayout.tsx:183、各页 H1）与 `text-2xl` 混用，层级靠「加粗」而非字号阶梯区分；数字（日期、倒计时、金额）全站未用 `tabular-nums`（仅 5 处），列表上下行数字宽度抖动；中文正文 14px（text-sm）+ 默认行高 1.43 偏挤。 |
| whitespace | **3/10** | 间距全部用 Tailwind 原始刻度（`p-4`/`px-3 py-2`/`space-y-1`）散写，无语义级阶梯；组件内间距与区块间距同值（卡片内 `p-6` 与页面区块 `p-6` 同级），视觉无节奏；桌面详情页两侧大量死白（截图 `item-detail-desktop-light.png`），移动端卡片内 5 个按钮间无喘息（截图 `items-mobile-light.png`）。 |
| visual_hierarchy | **3/10** | 页面 H1（`text-2xl font-semibold`）与卡片标题（CardTitle `text-2xl font-semibold`，`card.tsx:46-50`）同级，层级撞车；仪表盘 4 张统计卡与下方列表视觉权重相同，无「主数据 → 次级」引导；列表行内名称/备注/日期/状态字号仅 sm/xs 两档差，扫读时找不到锚点（截图 `items-desktop-light.png`）。 |
| color | **4/10** | 仅 shadcn 默认 zinc/blue 双色板（`index.css:32-52`）；语义色只有 destructive 一个，成功/警告/信息全靠临时硬编码（如 AppLayout 的 `bg-yellow-500/90`、`bg-blue-500/90`，AppLayout.tsx:221,240）；无中性色阶 token（灰只有 muted 一档）；暗色主色 `hsl(211 100% 50%)` 与亮色 `hsl(221.2 83.2% 53.3%)` 不是同一色相族，主题切换像换了一个品牌（`index.css:63` vs `:41`）。 |
| motion | **1/10** | 全站无 `duration-*`/`ease-*`，所有动效 = `transition-colors`（仅颜色插值，150ms 默认缓动）；页面切换 0 过渡；列表项 hover 只有背景色变化；加载 = 全局 `animate-pulse` 灰块，无骨架屏形态、无 stagger；移动端底部导航切换无指示器移动动画（截图 `items-mobile-light.png` 底部）。 |
| micro_interaction | **2/10** | 按钮 hover 仅 `bg-primary/90`（button.tsx:8）；无按下态（active:scale）；开关 Switch 切换无弹性反馈；删除等危险操作仅靠红色 icon 区分，无二次确认外的任何触觉/视觉反馈设计；表单校验错误无入场动画；toast（Radix Toast）默认样式未定制。 |
| responsive | **4/10** | 双布局（桌面侧栏 / 移动底栏）骨架成立，safe-area 处理到位（`index.css:88-93`）；但移动表格→卡片是「塞入」而非重构（7 列信息 + 5 按钮全保留，截图 `items-mobile-light.png`）；中间断点（768-1024 平板）无定义，桌面侧栏 256px 在 1024 下挤压内容；详情页长表单移动端无分组折叠，滚动长度超 3 屏。 |
| originality | **2/10** | 视觉语言 = 开箱 shadcn 默认（zinc + blue + 0.5rem 圆角 + 默认卡片），与任何 SaaS 模板不可区分；eNotify 的核心语义「到期/倒计时/周期费用/触达」在视觉层完全缺席：倒计时只是绿色小圆点+「43d」文字（截图 `items-desktop-light.png`），没有进度、紧迫感梯度、周期节律等任何专属表达。 |

---

## 2. 基准调研（每维度获奖参照）

### typography
1. **Linear**（linear.app，Awwwards SOTD）— 用 Inter 单字族 + 极端克制的字号阶梯（13/14/16/21/28px 五档），标题靠字重 510→680 的微梯度而非字号跳跃分层；数字与代码一律 tabular。eNotify 学：少级数、每级有明确语义归属。
2. **Stripe**（stripe.com，多次 Webby）— 中英/符号混排时西文用 sohne、CJK 落到系统栈，标题 letter-spacing -0.02em 收紧、正文 0；行高西文 1.5 / 大字 1.25。eNotify 学：标题负字距 + 中文略宽行高。
3. **Readymag 自家站**（readymag.com，FWA）— display 级标题用超大号 + 极窄行高（0.95-1.05）制造张力，正文与标题字号比达 1:6。eNotify 学：仪表盘统计大数字应用 display 级处理。

### whitespace
4. **Apple 产品页**（apple.com，Webby 常任）— 区块间距是组件内间距的 3-4 倍（如组件内 24px、区块 96px），用留白倍数做节奏。eNotify 学：建立「内/外」间距比值规则。
5. **Things 3 官网**（culturedcode.com/things，Apple Design Award）— 留白即分隔：几乎不用分隔线，靠 64px+ 的纵向留白区分组。eNotify 学：减少 border 依赖。

### visual_hierarchy
6. **Height**（height.app，Awwwards Honorable Mention）— 每页一个「主数据锚点」（大号数字/进度），其余元素字级差 ≥2 档；列表行内主信息 15px/500，辅信息 13px/400 muted，恒定两档差。eNotify 学：行内两级差规则。
7. **Cron/Notion Calendar**（cron.com，Awwwards SOTD 提名）— 时间信息用「大数字 + 小单位」的非对称排版（如 "43" 大号 + "days" 小号），到期语义直接成为视觉主角。eNotify 学：倒计时数字的排版范式。

### color
8. **Wise**（wise.com，Webby Winner）— 单一高饱和品牌绿 + 全中性灰阶（8 级），品牌色只出现在行动点与关键数据上，克制产生识别度。eNotify 学：品牌色使用配额制。
9. **Vercel**（vercel.com，Awwwards）— 暗色主题不是反色：重调饱和度与层级（暗色下用边框代替阴影分层），语义色暗色版提高明度降饱和。eNotify 学：暗色独立调色而非反色。

### motion
10. **Stripe Press**（press.stripe.com，Awwwards SOTD）— 页面级转场 300-500ms + cubic-bezier 强调曲线，内容入场 stagger 40-60ms；所有动效时长可枚举（没有随意值）。eNotify 学：三档时长枚举。
11. **Family**（family.co，FWA SOTD）— 列表项 hover 同时位移 2-4px + 阴影抬升 + 箭头显现，多属性协同但全在 200ms 内完成。eNotify 学：微动效组合拳的时长上限。
12. **Linear 方法论文档**（linear.app/method）— 公开规定 UI 动效 150-300ms、ease-out 为主、禁用 bounce 于工具型界面。eNotify 学：工具型产品的动效克制边界。

### micro_interaction
13. **Things 3**（Apple Design Award）— 完成待办的勾选：图标形变 + 整行 200ms 淡出 + 列表重排，一个动作三段反馈。eNotify 学：操作确认的分段反馈。
14. **Superhuman**（superhuman.com，Webby）— 每个可达元素 100ms 内的即时 hover 反馈 + 快捷键提示 tooltip 延迟 400ms 出现；反馈分层（即时/延迟）。eNotify 学：反馈延迟分层。

### responsive
15. **Pitch**（pitch.com，Awwwards）— 移动端不是桌面压缩版：列表卡片重构成「主信息 + 次要抽屉」，操作收进溢出菜单，单行操作 ≤2 个。eNotify 学：移动端操作配额。
16. **Linear 移动端**（linear.app 响应式）— 底部导航激活态有指示 pill 滑动动画（layoutId 共享元素），tab 切换内容交叉淡入。eNotify 学：底栏激活态表达。

### originality
17. **Cron/Notion Calendar**（同上）— 把「时间」做成产品的主视觉语言（时间块、进度、节奏栅格），品牌与功能语义合一。eNotify 学：从「到期/周期」长视觉语言。
18. **Copilot Money**（copilot.money，Apple Design Award 提名）— 费用类产品用「燃尽进度条 + 剩余天数」作为首屏主视觉，数字全部 tabular + 大字号。eNotify 学：周期费用的可视化范式。
19. **Wise**（同上）— 汇率倒计时锁价（"rate guaranteed for 38 hours"）用环形进度表达紧迫感。eNotify 学：紧迫感的图形化。

---

## 3. 视觉方向定案（originality 的主张）

### 主张：**「时间账本 Ledger of Time」**

eNotify 的视觉语言从它的核心语义直接长出来：**每一笔周期费用/到期事项都是时间轴上的一笔账**。具体可反驳的主张：

1. **倒计时是第一公民**：到期天数是列表/详情/仪表盘的视觉主角——大号 tabular 数字（display 级），配「剩余进度环/条」（已过去 vs 剩余），而不是绿色小圆点 + "43d" 文本。紧迫感通过颜色梯度表达：>30 天中性、≤30 天蓝、≤7 天琥珀、逾期红——这条梯度成为全站唯一的语义色梯度。
2. **周期节律可视化**：cycle/reset 模式用循环图形（环形进度/月相式圆点）表达，「本月已过去 ████░░ 60%」这类节律条成为仪表盘主视觉，呼应「账本」的记账行。
3. **账目式排版**：列表行 = 账本分录——左：名称（债务人式排版），右：金额 + 到期天数右对齐 tabular 数字栏，像银行账单一样可扫读。表格感、纵向对齐、克制分隔线。
4. **克制的工具气质**：无插画、无渐变 hero、无装饰图形；识别度全部来自排版 + 数字处理 + 时间图形，向 Linear/Things 的工具美学对齐。

### 为什么不是别的方向（三条反例）

- **不是「通知/铃铛」方向**（铃铛 icon、消息气泡、通知中心红点亮渐变风）：那是触达通道的语义，eNotify 的核心资产是「到期数据」而非「消息」；且通知中心风已被所有 IM/协作产品做滥，无区分度。
- **不是「日历」方向**（日历网格主视觉、月视图）：日历表达「时间点」但弱表达「剩余时长」与「周期循环」，而周期费用是 eNotify 区别于日程应用的核心；日历网格在移动端也必然退化成列表，等于白做。
- **不是「温暖生活手账」方向**（圆角加大 + 柔和 pastel + 插画）：与「费用到期提醒」需要的精确、可信、工具感相冲突；pastel 在暗色主题下维护成本高且对比度难达标；对 admin/2FA/安全设置等企业感页面气质不符。

---

## 4. 令牌规格（可直接写进 CSS 的值）

> 全部 token 写入 `web/src/index.css` 的 `@theme inline`；颜色类在 `.dark` 块维护同名覆盖。命名遵循 Tailwind v4 约定（`--font-*`、`--text-*`、`--spacing-*`、`--radius-*`、`--shadow-*`、`--ease-*`、`--color-*`）。

### 4.1 字体族（--font-*）

**主字体：自托管 Inter Variable（裁决定案，冻结）**——非 npm 依赖、非外部 CDN，woff2 资产入仓，保证离线与 PWA 可用。

- 资产（已随契约入仓）：`web/src/assets/fonts/InterVariable.woff2`（344KB）与 `InterVariable-Italic.woff2`（379KB），许可 `web/src/assets/fonts/INTER-LICENSE.txt`（OFL，来源 Inter 4.1 官方 release）。
- `@font-face`（唯一声明位置：`web/src/index.css` 顶层，`@theme` 之外）：

```css
@font-face {
  font-family: "Inter";
  src: url("./assets/fonts/InterVariable.woff2") format("woff2");
  font-weight: 100 900;
  font-style: normal;
  font-display: swap;
}
@font-face {
  font-family: "Inter";
  src: url("./assets/fonts/InterVariable-Italic.woff2") format("woff2");
  font-weight: 100 900;
  font-style: italic;
  font-display: swap;
}
```

```css
--font-sans: "Inter", ui-sans-serif, -apple-system, "SF Pro Text", "Segoe UI",
  Roboto, "Helvetica Neue", Arial, "PingFang SC", "Hiragino Sans GB",
  "Microsoft YaHei", "Noto Sans CJK SC", sans-serif;
--font-mono: ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas,
  "Liberation Mono", monospace;
```

- Inter 首顺位覆盖西文与数字；CJK 无 Inter 字形，自然落到 PingFang/雅黑——同字号下 PingFang 字面略大，正文级用 15px 而非 14px 补偿（见 4.2）。
- Inter 为可变字重字体，§4.2 的 400/500/600/650 四档字重全部原生成立，不再依赖回落。
- **等宽数字**：不另设字体，统一用 `font-feature-settings: "tnum"`（Tailwind `tabular-nums`），纳入数字专用工具类 `--font-numeric: var(--font-sans)` + 约定所有金额/日期/倒计时必须挂 `tabular-nums`（Inter 的 tnum 特性完整）。

### 4.2 字号阶梯（--text-*，含 line-height / 字重 / 字距）

| token | px | line-height | 字重 | letter-spacing | 语义归属 |
|---|---|---|---|---|---|
| `--text-caption` | 12 | 1.5 (18px) | 400 | 0.01em | 辅助说明、表头、徽章 |
| `--text-body-sm` | 13 | 1.5 (19.5px) | 400 | 0 | 次要正文、列表辅信息 |
| `--text-body` | 15 | 1.6 (24px) | 400 | 0 | 默认正文（中文为主，行高放宽） |
| `--text-body-strong` | 15 | 1.6 | 500 | 0 | 列表主信息、表单值 |
| `--text-title` | 17 | 1.4 (23.8px) | 600 | -0.01em | 卡片标题、分区标题 |
| `--text-heading` | 21 | 1.33 (28px) | 650 | -0.015em | 页面 H1 |
| `--text-display` | 28 | 1.2 (33.6px) | 650 | -0.02em | 详情页主数字/标题 |
| `--text-display-lg` | 36 | 1.15 (41.4px) | 650 | -0.025em | 仪表盘主统计数字（倒计时天数） |

- 字重仅允许 400/500/600/650 四档（650 由 Inter Variable 原生提供；极端情况下 Inter 加载失败回落系统栈时按 600 渲染，属可接受降级）。
- 中西文差异：标题级负字距仅作用于西文多的场景；中文占比高时字距归零（约定：含中文的 heading 不加额外 tracking 类）。中文正文行高 1.6，西文正文 1.5 可接受，统一取 1.6。

### 4.3 间距阶梯（--spacing-*，4px 基准）

| token | px | 用途 |
|---|---|---|
| `--spacing-1` | 4 | 图标-文字间隙、徽章内距 |
| `--spacing-2` | 8 | 组件内元素间（表单项 label-input） |
| `--spacing-3` | 12 | 组件内分组间 |
| `--spacing-4` | 16 | 卡片内边距（移动）、列表行内距 |
| `--spacing-6` | 24 | 卡片内边距（桌面）、表单字段组间 |
| `--spacing-8` | 32 | 卡片与卡片间、页面区块间（移动） |
| `--spacing-12` | 48 | 页面区块间（桌面） |
| `--spacing-16` | 64 | 页面级大区块分隔（仪表盘主视觉与列表） |

规则：区块间距 : 组件内间距 ≈ 2:1 起步（学 Apple），禁止 `space-y-1`/`p-2` 这类 8px 以下值用于区块级。

### 4.4 圆角阶梯（--radius-*）

| token | px | 用途 |
|---|---|---|
| `--radius-xs` | 4 | 徽章、tag、进度条 |
| `--radius-sm` | 6 | 输入框、小按钮 |
| `--radius-md` | 8 | 按钮、下拉项 |
| `--radius-lg` | 12 | 卡片、弹层、对话框 |
| `--radius-xl` | 16 | 页面级容器、底部抽屉 |
| `--radius-full` | 9999px | 头像、进度环、开关 |

替换现有 `--radius: 0.5rem` 单值派生体系（`index.css:27-30`），改为显式六级。「账本」气质 = 中小圆角为主，卡片 12px 封顶，禁止全站 16px+ 的软糖风。

### 4.5 阴影 / elevation（--shadow-*，明暗各一套）

亮色：

| token | 值 | 层级 |
|---|---|---|
| `--shadow-1` | `0 1px 2px rgb(0 0 0 / 0.05)` | 静止卡片 |
| `--shadow-2` | `0 1px 3px rgb(0 0 0 / 0.07), 0 4px 12px rgb(0 0 0 / 0.06)` | 悬浮卡片/hover 抬升 |
| `--shadow-3` | `0 4px 8px rgb(0 0 0 / 0.08), 0 12px 32px rgb(0 0 0 / 0.10)` | 下拉/弹出层 |
| `--shadow-4` | `0 8px 16px rgb(0 0 0 / 0.10), 0 24px 48px rgb(0 0 0 / 0.12)` | 对话框/抽屉 |

暗色（阴影失效，用边框 + 微光补偿）：

| token | 值 |
|---|---|
| `--shadow-1` | `0 0 0 1px rgb(255 255 255 / 0.06)` |
| `--shadow-2` | `0 0 0 1px rgb(255 255 255 / 0.08), 0 4px 12px rgb(0 0 0 / 0.4)` |
| `--shadow-3` | `0 0 0 1px rgb(255 255 255 / 0.10), 0 12px 32px rgb(0 0 0 / 0.5)` |
| `--shadow-4` | `0 0 0 1px rgb(255 255 255 / 0.12), 0 24px 48px rgb(0 0 0 / 0.6)` |

废止 `shadow-lg` 滥用（20 处）与 `shadow-sm` 混用，统一四级。

### 4.6 色彩（--color-*，含对比度实测）

**品牌主色：Indigo（靛蓝）**——从现行 blue 进化但保持连续性；靛蓝=「精确、账本、夜间可读」，避开通知红的语义冲突。

| 角色 | 亮色值 | 对比度（on 白） | 暗色值 | 对比度（on `#0a0a0c`） |
|---|---|---|---|---|
| primary | `#4f46e5` (indigo-600) | 6.29:1 ✅ | `#818cf8` (indigo-400) | 6.63:1 ✅ |
| primary-foreground | `#ffffff` | 6.29:1 ✅(on primary) | `#0a0a0c` | 6.63:1 ✅(on primary) |
| ring/focus | `#4f46e5` | ≥3:1 vs 相邻 ✅ | `#818cf8` | ✅ |

**中性色阶（8 级，亮色 zinc 系微调，暗色独立调色非反色）：**

亮色：`--n-0:#ffffff（bg）` `--n-50:#fafafa` `--n-100:#f4f4f5（muted bg）` `--n-200:#e4e4e7（border）` `--n-300:#d4d4d8（input border）` `--n-500:#666670（muted fg，on 白 6.10:1 ✅、on muted 5.16:1 ✅）` `--n-700:#3f3f46（次级 fg）` `--n-900:#18181b（主 fg，on 白 17.72:1 ✅）`

暗色：`--n-900:#0a0a0c（bg）` `--n-850:#111114（card bg）` `--n-800:#1a1a1f（muted bg）` `--n-700:#26262c（border）` `--n-600:#34343c（input border）` `--n-400:#a1a1aa（muted fg，on bg 7.76:1 ✅）` `--n-200:#d4d4d8（次级 fg）` `--n-50:#fafafa（主 fg，on bg 19.06:1 ✅）`

`--n-*` 是中性色的**唯一来源**；组件入口仍走既有 role token（`background/card/popover/muted/accent/border/input/ring/foreground` 等，见 `index.css:5-26`），role token 的值改为引用 `n-*`，不另设色值。**`n-* → role` 显式映射表（冻结）：**

| role token | 亮色映射 | 暗色映射 |
|---|---|---|
| `--background` | `n-0 #ffffff` | `n-900 #0a0a0c` |
| `--foreground` | `n-900 #18181b` | `n-50 #fafafa` |
| `--card` / `--popover` | `n-0 #ffffff` | `n-850 #111114` |
| `--card-foreground` / `--popover-foreground` | `n-900 #18181b` | `n-50 #fafafa` |
| `--muted` / `--accent` | `n-100 #f4f4f5` | `n-800 #1a1a1f` |
| `--muted-foreground` / `--accent-foreground` | `n-500 #666670` / `n-900` | `n-400 #a1a1aa` / `n-50` |
| `--secondary` | `n-100 #f4f4f5` | `n-800 #1a1a1f` |
| `--secondary-foreground` | `n-900 #18181b` | `n-50 #fafafa` |
| `--border` | `n-200 #e4e4e7` | `n-700 #26262c` |
| `--input` | `n-300 #d4d4d8` | `n-600 #34343c` |
| `--ring` | primary `#4f46e5` | primary `#818cf8` |

**语义色（成功/警告/信息/危险，亮色 on 白 / 暗色 on #0a0a0c，文本用法均实测）：**

| 语义 | 亮色文本值 | 对比度 | 暗色文本值 | 对比度 |
|---|---|---|---|---|
| success | `#15803d` (green-700) | 5.0:1 ✅ | `#4ade80` | 11.42:1 ✅ |
| warning | `#b45309` (amber-700) | 5.02:1 ✅ | `#fbbf24` | 11.92:1 ✅ |
| info | `#1d4ed8` (blue-700) | 6.7:1 ✅ | `#93c5fd` | 10.97:1 ✅ |
| danger | `#b91c1c` (red-700) | 6.47:1 ✅ | `#f87171` | 7.19:1 ✅ |

（徽章底用同族 10% 透明度，如 `success/10`。）

**命名兼容（冻结）**：危险色的实体 token 保留既有名 `--destructive` / `--destructive-foreground`（值写新 danger：亮色 `hsl(0 73.7% 41.8%)` = `#b91c1c`，暗色 `hsl(0 90.6% 70.8%)` = `#f87171`）；`danger` 是文档与沟通中的语义名，落地映射为 **`danger → --destructive`**（`bg-danger`/`text-danger` 一律写成 `bg-destructive`/`text-destructive`）。success/warning/info 新增同名 token。

**功能色 = 倒计时紧迫梯度（本契约的语义核心，替换现状「一律绿点」）：**

| token | 阈值 | 亮色 | 暗色 |
|---|---|---|---|
| `--color-due-far` | >30 天 | neutral `#666670` | `#a1a1aa` |
| `--color-due-soon` | ≤30 天 | `#4f46e5` | `#818cf8` |
| `--color-due-close` | ≤7 天 | `#b45309` | `#fbbf24` |
| `--color-due-over` | 逾期 | `#b91c1c` | `#f87171` |

### 4.7 动效（--ease-* + --duration-*）

```css
--duration-fast: 120ms;    /* hover、按下、开关 */
--duration-standard: 200ms; /* 展开/收起、tooltip、tab 切换 */
--duration-slow: 320ms;    /* 页面转场、抽屉、骨架退场 */

--ease-out: cubic-bezier(0.22, 1, 0.36, 1);      /* 进入/出现（强调） */
--ease-in: cubic-bezier(0.64, 0, 0.78, 0);       /* 退出/消失 */
--ease-standard: cubic-bezier(0.2, 0, 0, 1);     /* 通用状态变化 */
```

规则：交互反馈一律 ≤200ms（Linear 边界）；位移类只用 transform/opacity；禁用 bounce/elastic；列表入场 stagger 步长 40ms、上限 6 项；`prefers-reduced-motion` 时全部降级为 opacity 淡变（Stage 3 实现时纳入全局 media query）。

---

## 5. 落地映射：19 页面 + AppLayout 改动清单

> 「结构」= 不只是换 token，需要调整 DOM/组件结构。

| 页面 | 改动 |
|---|---|
| `AppLayout` | 结构：移动端底栏激活态加共享 pill 指示器（layoutId 滑动，200ms ease-out）；桌面侧栏激活项用 `--color-primary/10` + 左侧 2px 指示条；移除硬编码 `bg-yellow-500/90`/`bg-blue-500/90` 横幅 → info/warning 语义 token；`text-xl font-bold` 的 appName → `--text-title`。 |
| `dashboard` | 结构：主视觉区改为「最近到期 Top 卡片」——大号 `--text-display-lg` tabular 倒计时数字 + 环形剩余进度（新组件 `DueRing`）；统计卡 4 → 3（本月支出/30 天内到期/已逾期），数字用 display 级；骨架屏改为与内容同形态（stagger 40ms）。 |
| `items`（列表） | 结构：桌面行右侧新增「金额 + 天数」右对齐 tabular 分录栏；「43d」绿点 → 环形微进度 + 天数（due-* 梯度着色）；移动端卡片重构：主行（名称+天数大数字）/ 次行（日期+分类）/ 操作收进溢出菜单（可见操作 ≤2：编辑+更多）。 |
| `items/new`、`items/:id`（详情 46.9K） | 结构：表单分区（基本信息 / 周期与到期 / 提醒与渠道 / 备注），分区标题 `--text-title` + `--spacing-8` 分隔；桌面双栏（左字段右摘要预览卡：实时到期倒计时环）；移动端分区手风琴；日期/周期输入行改 grid 2 列。 |
| `channels` | 卡片标题层级修正（CardTitle → `--text-title`）；渠道启用状态徽标接 success/due token；测试按钮结果反馈加 200ms 状态动画。 |
| `history` | 时间线化：按日分组，组标题 sticky + `--text-caption` 大写字距；发送状态图标 success/danger token；空状态插画位 → 纯排版空态（display 级图标 + 一行文案 + CTA）。 |
| `me` | 用户卡改「账本头」：头像 + 邮箱 + 当月到期笔数统计（tabular display 数字）。 |
| `settings`（47.4K，最大页） | 结构：tab 栏激活态加下划线滑动动画（200ms）；表单分区同 items 规则；`animate-pulse` 灰块（595/821 行）→ 同形态骨架。 |
| `about` | 排版页：版本/链接信息用分录式定义列表（左 caption 右 body-strong）。 |
| `admin` ×5（admin/users/email/security/app） | 表格行高统一 `--spacing-4`；`AdminUsersPage` 骨架（365-369 行）→ 行形态骨架；危险操作按钮统一 danger token + ConfirmDialog 入场 320ms ease-out。 |
| `auth` ×5（login/register/forgot/2fa/verify-email） | 居中卡升级：卡宽 400px、`--shadow-2`、logo 区 `--text-display`；输入错误态：边框 danger + 文案 200ms 滑入；提交按钮 loading 态（spinner + 文案宽度保持）。 |
| `setup` | 同 auth 卡规范；步骤指示器用 due 环形语言呼应主视觉。 |

---

## 附录 A：契约修订记录

### A-1（ONE-70，2026-10-23，Mike 授权修订）

- **问题**：冻结值 `muted-foreground on muted`（`n-500 #71717a` on `n-100 #f4f4f5`）实测对比度 4.39:1，低于父单 color 维度的 AA 正文指标（≥4.5:1），差 0.11。
- **修订**：亮色 `n-500` 由 `240 3.8% 46.1%`（`#71717a`）调整为 `240 4.9% 42%`（`#666670`）。同步引用该值的 token：`--muted-foreground`（亮色）与 `--due-far`（亮色）。
- **达标后对比度**：`n-500 on n-100` = **5.16:1** ✅；`n-500 on n-0`（白底）= **6.10:1** ✅。暗色组合（`n-400 on n-800` = 6.76:1）原本达标，未动。

---

## 6. 契约边界（与冻结条款对齐）

- **唯一契约**：本文件是唯一冻结契约。历史文档 `web/docs/design-contract.md`（存在于旧分支 `agent/mary/a19f619bb981` / `ed2f1ad360d5`，未进 main）**已退役**，不再作为任何实现依据；若其所在分支后续合并，必须删除该文件或以醒目批注指向本文档。
- 令牌只写 `web/src/index.css` `@theme inline`；`.dark` 维护同名覆盖（含 4.5 暗色阴影套）。
- 字体资产入仓于 `web/src/assets/fonts/`，`@font-face` 声明于 `index.css` 顶层；不引入新框架/组件库/动画库/外部字体 CDN。
- 不动 `worker/`、路由、API、既有 i18n key 语义。
- 命名兼容：`danger → --destructive`（见 §4.6）；其余令牌按本文档 §4 命名原样保留，旧引用（6 个 `ui/*` 组件 + `AppLayout` 中的 shadow/rounded 等旧名）由 Stage 2 落地时统一替换。
- 本单不写实现代码；实现由后续 Stage 子单按本文执行。
