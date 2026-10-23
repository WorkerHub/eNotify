# eNotify 设计契约（冻结版 · Stage 1 产出）

> 本文件是 ONE-75（Stage 1）的交付物，是 Stage 2/3/4 视觉升级的**唯一依据**。
> 任何实现若与本契约冲突，以本契约为准；契约未覆盖处，按本文件第 0 节的原则推导，不得另起风格。

## 0. 总体设计立场

eNotify 是一个**到期事项/费用追踪 + 多渠道提醒**的工具型产品（PWA，移动端优先，中英双语，明暗双主题）。奖项级工具产品的共性不是炫技，而是：

1. **排版即界面**——用字阶、字重、字距建立层级，而不是用色块和边框堆层级；
2. **留白是主动设计决策**——密度有节奏（呼吸区 / 工作区），不是均匀铺满；
3. **动效克制且物理**——150–300ms、单一缓动族、只对用户操作做反馈；
4. **颜色做减法**——一个品牌色 + 一套中性灰阶 + 语义色，全站可枚举；
5. **原创性来自“气质一致”**——每一处细节都能认出是同一个产品，而非拼贴。

视觉方向定案：**「安静的精确」（Quiet Precision）**——以编辑级排版 + 严谨的 4pt 间距栅格 + 极少量高饱和品牌色点缀，营造“专业记账/提醒工具”的可信赖感；移动端保留原生 App 手感（安全区、底部导航、KeepAlive 均不回归）。

---

## 1. Typography（排版）

### 现状差距
- 全站只有事实上的三个字号在用（`text-xs/sm/base/2xl` 零星混用），无系统字阶；
- 中英文混排未做字体族分级，中文回落到系统默认，字重只有 `font-medium/bold` 两档可用感；
- 数字（金额、日期、倒计时）未使用等宽/tabular figures，列表中对齐抖动；
- 行高使用 Tailwind 默认值，标题与正文的行高没有按用途区分；
- 无字距（letter-spacing）策略：大标题未收紧，小号全大写标签未放宽。

### 设计决策
- 建立 **8 级字阶**（display / h1 / h2 / h3 / body / small / caption / overline），全部落为 token；
- 字体族三级：`--font-sans`（UI 与中文）、`--font-display`（大数字与品牌标题，复用 sans 栈但配合字重/字距）、`--font-mono`（金额、日期、倒计时、代码），数字统一 `font-variant-numeric: tabular-nums`；
- 行高按用途三档：`--leading-display: 1.1`（大标题）、`--leading-title: 1.25`（卡片/区块标题）、`--leading-body: 1.6`（正文与列表，兼顾中文）；
- 字距：display/h1 收紧 `-0.02em`；overline（全大写小标签）放宽 `+0.08em`；正文默认 0；
- 字重只用三档：400（正文）/ 500（强调、导航激活）/ 600（标题、数字）。**禁用 700+**（粗黑标题是“模板感”的主要来源）。

### Token 规格（落进 `index.css` `@theme inline`）
```css
--font-sans: "Inter", "SF Pro Text", -apple-system, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans SC", sans-serif;
--font-display: "Inter", "SF Pro Display", -apple-system, "PingFang SC", "Noto Sans SC", sans-serif;
--font-mono: "SF Mono", "JetBrains Mono", ui-monospace, "Roboto Mono", monospace;

--text-display: 2rem;      /* 32px — 仪表盘核心数字、空状态主标题 */
--text-h1: 1.5rem;         /* 24px — 页面标题 */
--text-h2: 1.25rem;        /* 20px — 区块标题 */
--text-h3: 1rem;           /* 16px — 卡片标题、列表主行 */
--text-body: 0.875rem;     /* 14px — 正文（现状主流字号，保持） */
--text-small: 0.8125rem;   /* 13px — 辅助说明 */
--text-caption: 0.75rem;   /* 12px — 时间戳、标签 */
--text-overline: 0.6875rem;/* 11px — 全大写分组标签 */

--leading-display: 1.1;
--leading-title: 1.25;
--leading-body: 1.6;

--tracking-tight: -0.02em;   /* display/h1 */
--tracking-normal: 0;
--tracking-wide: 0.04em;     /* 按钮、小标签 */
--tracking-overline: 0.08em; /* 全大写 overline */

--font-weight-regular: 400;
--font-weight-medium: 500;
--font-weight-semibold: 600;
```

### 基准参照
- **Linear**（https://linear.app，Awwwards Site of the Day 2021）——工具类产品排版标杆：Inter 字体族、`-0.02em` 收紧标题、tabular 数字、字重克制在 400/500/600。eNotify 与其同为“效率工具”，此字阶可直接验证成熟。
- **Stripe Dashboard**（https://stripe.com，Webby Awards 多次获奖）——金额/日期的 tabular-nums 与三级行高策略的直接参照。

---

## 2. Whitespace（留白与间距）

### 现状差距
- 页面容器 `px-4 pt-2 pb-4 md:p-6`，卡片 `p-4` 一刀切，缺乏“区块之间比区块内部更松”的节奏；
- 移动端 `pt-2` 过紧，页面标题几乎贴顶栏；
- 列表行间距与卡片内边距未形成倍数关系，肉眼可见“这里 12px 那里 15px”。

### 设计决策
- **4px 基准栅格**：所有间距取 4 的倍数，集中在 8 档 token；
- 节奏规则：**区块间距 ≥ 2× 卡片内边距**；页面首屏顶部留白 ≥ 24px（移动端含安全区）；
- 密度分区：导航/工具栏为“紧凑区”（spacing-2/3），内容卡片区为“呼吸区”（spacing-4/6），页面级区块分隔用 spacing-8/10；
- 容器最大宽度从 `max-w-6xl` 收敛为 `max-w-5xl`（56rem），配合更大行宽留白提升阅读感（表单/列表类页面尤其明显）。

### Token 规格
```css
--spacing-1: 0.25rem;   /* 4  — 图标与文字间隙 */
--spacing-2: 0.5rem;    /* 8  — 紧凑元素组 */
--spacing-3: 0.75rem;   /* 12 — 列表行内 padding-y */
--spacing-4: 1rem;      /* 16 — 卡片内边距（移动端） */
--spacing-5: 1.25rem;   /* 20 — 卡片内边距（桌面端） */
--spacing-6: 1.5rem;    /* 24 — 页面水平 padding、区块小分隔 */
--spacing-8: 2rem;      /* 32 — 区块分隔 */
--spacing-10: 2.5rem;   /* 40 — 页面级大区块分隔 */
```
（Tailwind v4 默认 spacing 已是 4px 倍数体系，此处冻结“只用以上档位”，组件里不得出现 `p-[13px]` 之类的任意值。）

### 基准参照
- **Things 3 (Cultured Code)**（https://culturedcode.com/things/，Apple Design Award）——任务工具中“呼吸区/紧凑区”节奏的最佳范本：列表紧凑、区块间慷慨留白。
- **Height**（https://height.app，Awwwards Honorable Mention）——4pt 栅格 + 收敛容器宽度在 SaaS 工具中的落地参照。

---

## 3. Visual Hierarchy（视觉层级）

### 现状差距
- 层级主要靠 `border` + `font-bold` 表达，卡片全是同款边框同款圆角， Dashboard 统计卡与次要信息视觉权重相同；
- 页面无统一“页头”范式：有的页面有大标题，有的直接进列表；
- 主要操作（主按钮）与次要操作在多处同为实色按钮，权重不分。

### 设计决策
- **三级层级模型**：L1 页面标题（h1 + 可选副标题，每页必须有统一页头）；L2 区块标题（h2/overline 分组标签）；L3 内容；
- 用**灰阶与字重**代替边框建立层级：卡片去边框、改用极浅填充 + 1 级阴影（dark 模式改用亮度差），边框只保留给输入态与分隔线；
- 每屏**至多一个主按钮**（primary 实色），其余操作一律 secondary/ghost；破坏式操作用 destructive，禁用“红按钮当强调色”；
- 仪表盘统计卡建立“主指标 vs 次指标”两级：主指标用 display 字阶，次指标用 h3 + caption。

### Token 规格
层级不新增颜色 token，复用第 4 节灰阶；新增层级阴影：
```css
--shadow-card: 0 1px 2px hsl(var(--foreground) / 0.04);        /* 静态卡片 */
--shadow-raised: 0 2px 8px hsl(var(--foreground) / 0.06);      /* hover/浮起 */
--shadow-overlay: 0 8px 24px hsl(var(--foreground) / 0.12);    /* 弹层/下拉 */
```
（dark 模式下阴影透明度翻倍：0.08 / 0.12 / 0.24，在 `.dark` 块覆盖。）

### 基准参照
- **Notion**（https://notion.so，Webby Awards 2020/2021）——“无框卡片 + 灰阶层级”的教科书：边框消失后层级反而更清晰。
- **Vercel Dashboard**（https://vercel.com，Awwwards Dev Award）——每屏单一主按钮、页头范式的直接参照。

---

## 4. Color（色彩）

### 现状差距
- 亮色主题色板为 shadcn 默认蓝（`221.2 83.2% 53.3%`），与深色主题品牌蓝（`211 100% 50%`）**不一致**，同一产品两个品牌色；
- 灰阶只有 muted/accent 两档，且深色模式是纯黑底（`0 0% 0%`）+ 三档灰，偏“硬核 terminal”而缺层次；
- 组件里存在语义色直写（`text-red-500`、`text-green-500`、`bg-yellow-500/90`、`bg-blue-500/90`），绕过 token 体系，换肤即破。

### 设计决策
- **统一品牌色**：亮暗两主题共用同一色相（222 蓝），只调亮度/饱和度；
- 中性灰阶扩为 5 档（background / card / muted / border / foreground 阶梯），深色模式从纯黑改为**蓝调深灰**（与品牌色同族），层次感来自亮度而非新色相；
- **语义色全部 token 化**：`--success` / `--warning` / `--info` 补齐，与既有 `--destructive` 并列；组件中 `text-red-500` 等直写全部替换为 token（同时消除 AppLayout 里 `bg-yellow-500/90`、`bg-blue-500/90` 两处裸色）；
- 强调色使用纪律：primary 只用于“当前位置 + 主操作”，页面内彩色面积 < 10%。

### Token 规格（`:root` 亮色）
```css
--background: 0 0% 100%;
--foreground: 222 47% 11%;
--card: 0 0% 100%;
--card-foreground: 222 47% 11%;
--popover: 0 0% 100%;
--popover-foreground: 222 47% 11%;
--primary: 222 89% 55%;              /* 统一品牌蓝 */
--primary-foreground: 210 40% 98%;
--secondary: 220 14% 96%;
--secondary-foreground: 222 47% 11%;
--muted: 220 14% 96%;
--muted-foreground: 220 9% 46%;
--accent: 220 14% 96%;
--accent-foreground: 222 47% 11%;
--destructive: 0 84% 60%;
--destructive-foreground: 210 40% 98%;
--success: 152 69% 40%;              /* 新增：下跌/节省/已支付 */
--success-foreground: 0 0% 100%;
--warning: 38 92% 50%;               /* 新增：临期提醒 */
--warning-foreground: 0 0% 100%;
--info: 211 100% 45%;                /* 新增： impersonation/PWA 提示条 */
--info-foreground: 0 0% 100%;
--border: 220 13% 91%;
--input: 220 13% 91%;
--ring: 222 89% 55%;
```

`.dark` 深色（同族蓝调深灰，替换纯黑）：
```css
--background: 222 24% 7%;
--foreground: 220 14% 92%;
--card: 222 22% 10%;
--card-foreground: 220 14% 92%;
--popover: 222 22% 10%;
--popover-foreground: 220 14% 92%;
--primary: 217 100% 61%;             /* 暗色提高亮度保证对比度 */
--primary-foreground: 222 47% 11%;
--secondary: 222 16% 14%;
--secondary-foreground: 220 14% 92%;
--muted: 222 16% 14%;
--muted-foreground: 220 9% 56%;
--accent: 222 16% 16%;
--accent-foreground: 220 14% 92%;
--destructive: 0 84% 62%;
--destructive-foreground: 0 0% 98%;
--success: 152 60% 48%;
--success-foreground: 222 47% 11%;
--warning: 38 92% 55%;
--warning-foreground: 222 47% 11%;
--info: 211 100% 60%;
--info-foreground: 222 47% 11%;
--border: 222 14% 18%;
--input: 222 14% 20%;
--ring: 217 100% 61%;
```
同时在 `@theme inline` 增加 `--color-success / --color-warning / --color-info` 及其 `-foreground` 映射（与既有 token 同法），WCAG AA（正文对比度 ≥ 4.5）由上述亮度值保证，Stage 2 落地后需用对比度工具抽验 primary/destructive 上的前景色。

### 基准参照
- **Linear**（https://linear.app）——品牌蓝在亮/暗主题只调亮度不调色相的做法，与本契约第 4 节完全一致；
- **Raycast**（https://raycast.com，Awwwards Site of the Day 2022）——深色模式“蓝调深灰而非纯黑”的参照；语义色 token 化 + 彩色面积纪律参照其设置页。

---

## 5. Motion（动效）

### 现状差距
- 全站只有 `transition-colors` 和 `animate-pulse`，无入场动效、无高度/位移动效；
- 无缓动与时长规范，`transition-colors` 默认 150ms linear-ish，弹层直接出现/消失。

### 设计决策
- **一条缓动族**：标准 `ease-out-expo` 用于入场/位移，`ease-in-out` 用于状态互转；禁用 `linear` 与弹跳缓动（弹跳与“安静的精确”气质冲突）；
- **三档时长**：micro 120ms（hover/press）、ui 200ms（下拉/弹层/Tab）、page 300ms（页面级淡入）；
- **动效只做三件事**：①操作反馈（hover/press 的 color + 2% scale）；②空间关系（弹层从触发点方向 fade+translate 4px）；③等待提示（skeleton pulse，保留现状）；
- 页面切换不做转场动画（PWA KeepAlive 场景下转场会闪烁，得不偿失）；
- 尊重 `prefers-reduced-motion`：全局一处 media query 关闭所有非 color 动效。

### Token 规格
```css
--ease-standard: cubic-bezier(0.22, 1, 0.36, 1);   /* ease-out-expo，入场/位移 */
--ease-emphasized: cubic-bezier(0.4, 0, 0.2, 1);   /* 状态互转 */
--duration-micro: 120ms;
--duration-ui: 200ms;
--duration-page: 300ms;
```
配套全局规则（`index.css` 普通层）：
```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
```

### 基准参照
- **Apple Human Interface Guidelines / apple.com**（Webby Awards 常任获奖）——120–300ms、ease-out 为主、reduced-motion 尊重，是本节数值的来源；
- **Stripe**（https://stripe.com）——“弹层 fade + 4px 位移”微动效的直接参照。

---

## 6. Micro-interaction（微交互）

### 现状差距
- 按钮 hover 仅变色，无 press 态；switch、tab 无过渡；骨架屏存在但列表加载为跳变；
- 表单校验反馈仅有文字错误，输入框无状态色过渡；
- 成功/失败操作依赖 toast，toast 本身无进入/退出动画。

### 设计决策（全部用 CSS 完成，不引动画库）
- **按钮**：hover 亮度 -4%、`active:scale-[0.98]`（duration-micro）；focus-visible 统一 2px ring（保留现有 ring token）；
- **输入框**：focus 时 border→ring 双色过渡（duration-ui），错误态 border-destructive + 抖动**不做**（抖动属弹跳系，违反第 5 节），改用图标 + 文字色过渡；
- **Switch**：thumb 位移 200ms ease-standard（Radix Switch 已有 data-state，补 transition 即可）；
- **Toast/弹层**：进入 `opacity 0→1 + translateY(4px→0)`，退出反向，duration-ui；
- **列表项**：hover 背景 accent 过渡 120ms；删除等破坏操作的目标项先做 200ms 淡出再移除（可用 Web Animations API 少量实现）；
- **底部导航（移动端）**：激活项图标颜色过渡 + label 字重 400→500，不做位移弹跳。

### Token 规格
复用第 5 节 duration/easing token；新增：
```css
--press-scale: 0.98;   /* active 态缩放（通过 Tailwind arbitrary 或工具类使用） */
```

### 基准参照
- **Things 3 / Cultured Code**（https://culturedcode.com/things/）——press 缩放与列表 hover 反馈的克制度参照；
- **Linear**（https://linear.app）——Toast 与弹层 fade+translate 的实现参照，其全部动效均为 CSS 完成，证明“不用动画库也能到奖项级”。

---

## 7. Responsive（响应式）

### 现状差距
- 断点只有 `md:`（768px）一档，桌面端宽屏下内容拉宽至 6xl 后卡片拉伸变形；
- 移动端字号与桌面相同，display 级数字在小屏过大；
- 表格/宽列表（AdminUsers、History）在 768–1024px 区间体验差。

### 设计决策
- 断点策略冻结为三档使用：`<768` 移动布局（底部导航）、`768–1279` 平板/小桌面（侧边栏 + 内容单列）、`≥1280` 宽屏（容器限宽 `max-w-5xl` 居中）；**不新增自定义断点**；
- 字号响应：display 在 <768 降为 1.75rem（28px），h1 降为 1.375rem（22px），其余不变（用 `md:` 前缀实现，token 值不变）；
- 网格响应规则：统计卡 <768 两列 → ≥768 四列；表单一律单列（现状保持）；
- 触控目标 ≥ 44×44px（底部导航项、列表行可点区、icon 按钮需 padding 补足），安全区适配保持现状不回归。

### Token 规格
```css
--container-max: 56rem;        /* max-w-5xl，页面容器限宽 */
--touch-target: 2.75rem;       /* 44px 最小触控尺寸 */
```

### 基准参照
- **Apple Developer / App Store Connect** 类工具布局 + **Stripe Dashboard** 的“三档断点 + 容器限宽”策略（https://stripe.com）；
- **Responsively App 推荐的 Awards 级工具站共性**：触控目标 ≥44px 来自 Apple HIG，本节直接采用。

---

## 8. Originality（原创性）

### 现状差距
- 现状是“shadcn 默认皮”，与任何 shadcn 模板站无法区分；
- 无品牌记忆点：logo 区只是文字 `text-primary`，空状态无插画/无语气设计。

### 设计决策（原创性不靠插画，靠三个可识别的“签名”）
1. **倒计时作为视觉主角**：eNotify 的核心数据是“还有几天到期”。仪表盘与列表把“剩余天数”设计为 tabular 数字 + 语义色渐变（>30 天 muted / 7–30 天默认 / <7 天 warning / 逾期 destructive）的**日期徽章（day badge）**，全站统一组件，成为产品视觉签名；
2. **品牌字标处理**：顶栏 appName 用 display 字体 + tracking-tight + primary 色，末尾配一个 2px 的 primary 圆点（“eNotify.”），低成本但可识别；
3. **空状态语气系统**：每个空状态为「overline 小标签 + display 标题 + 一句行动文案 + 主按钮」四件套，全站句式统一（Stage 3 逐页落地，不新增 i18n 之外的资源）。

### Token 规格
不新增 token；日期徽章复用第 4 节语义色 + 第 1 节 mono/tabular 数字。

### 基准参照
- **Cron / Notion Calendar**（https://cron.com，Awwwards Honorable Mention，现为 Notion Calendar）——“把核心数据（时间）做成视觉签名”的直接参照：其日期方块成为品牌资产，eNotify 的 day badge 走同一路径；
- **Basecamp / HEY**（https://hey.com，Webby Awards）——“空状态语气系统”的参照：统一句式比插画更能建立产品人格，且不引入新依赖与新资源。

---

## 9. 落地约束核对（与冻结接口契约逐条对齐）

| 契约条目 | 本契约的遵守方式 |
|---|---|
| 技术栈不换、不引动画库 | 全部动效为 CSS transition/animation，仅删除淡出允许少量 WAAPI；零新依赖 |
| 令牌集中于 `@theme inline` | 本文所有 token 均落在 `index.css`；并新增规则：组件禁止裸 hex/`hsl()`，现有 `text-red-500` 等直写列入 Stage 2 清理清单 |
| 组件 API 兼容 | 新视觉只通过 cva variant 与既有 className 扩展，`components/ui/*` 导出名与 props 不变 |
| 页面契约不变 | 不碰路由、守卫、`lib/api.ts`；容器宽度变化只在 AppLayout 的 className |
| 不得回归 | PWA 安全区变量、底部导航、`.dark`、i18n、WebAuthn 流程均不涉及结构性改动；reduced-motion 仅增强 |
| 质量门 | Stage 2/3 每步跑 `pnpm build && pnpm typecheck && pnpm lint`；不改 `biome.json` |

## 10. Stage 2 待办清单（据此契约派生）

1. `index.css`：落第 1/4/5 节全部 token（含 `.dark` 覆盖与 `@theme inline` 映射）；加 reduced-motion 规则。
2. 清理裸色：`DashboardPage`（red/green-500）、`AppLayout`（yellow/blue-500/90）→ 语义 token。
3. `components/ui/*`：button 增 press 态、switch/tabs 补过渡、card 去边框改 `--shadow-card`（cva variant 扩展，签名不变）。
4. `AppLayout`：容器 `max-w-6xl → max-w-5xl`；页头范式预留结构（Stage 3 逐页填充）。
5. 抽验对比度（AA）与 reduced-motion 行为。
