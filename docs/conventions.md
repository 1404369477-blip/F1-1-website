# 编码约定

> 本文件只管「代码长什么样」:命名、风格、目录、测试。
> 「行为规矩」(小步提交、加依赖先问、完成=已验证等)在 [agent-guide.md](agent-guide.md),这里不重复。
> 多数条目要等技术栈定了(M1)才能填实。

## 现在就成立的

- TypeScript 使用严格模式；缩进为 2 个空格，语句使用分号，字符串优先使用双引号。
- 目录使用 kebab-case；函数、变量使用 camelCase；类型、React 组件和 Zod schema 使用 PascalCase；环境变量使用 UPPER_SNAKE_CASE。
- 新代码读起来应像周围的代码。小模块优先使用显式返回类型和窄的输入类型，避免用类型断言掩盖不完整输入。
- `src/server/**` 是 server-only 边界：数据库、环境变量、文件系统和内部日志不得从客户端组件导入；页面只消费脱敏 DTO。

## 工具与错误边界

- ESLint 使用 `eslint.config.mjs` 的 Next flat config；TypeScript 使用 `strict: true`；本地不额外引入格式化器。
- 外部 fixture、配置和 API 边界使用 Zod 或等价的显式校验，未知字段和未知能力 fail closed。
- 错误使用可判定的错误码和短消息；禁止把 secret、token、原始私密 payload、绝对路径或内部堆栈写入日志和 DTO。
- 结构化日志只允许事件、状态、trace/operation 引用、哈希和错误分类等安全字段；敏感键在序列化前脱敏。
- 数据库写入必须经过 `src/server/db/` 的事务边界。迁移只追加，seed 必须可重复且不提升 M3 影子数据的 `enabled` 状态。

## app/ 内部布局(Kickoff 初始化 app/ 时必须填实)

> 技术栈定了之后,先把下面四个槽位定下来再写代码。
> 定下后,所有代码和测试按此归位,AI 不要随手另起目录乱放。

- **源码放哪**: `app/src/`；App Router 页面和 Route Handler 在 `app/src/app/`，领域模块在 `app/src/modules/`，server-only 配置、DB、provider、worker、安全边界在 `app/src/server/`。
- **测试放哪**: `app/src/tests/`，与源码同属 app 包；单元、合同和失败路径测试使用 `*.test.ts`。临时探针仍放 `scratch/`，不作为正式验收。
- **配置 / 环境变量放哪**: 安全默认值只在 `app/.env.example`；本地真值放未跟踪的 `app/.env`。SQL 迁移在 `app/migrations/`，fixture 输入在 `app/fixtures/` 或冻结 `data/` 只读路径，命令入口在 `app/scripts/`。
- **怎么算"验证过了"**: 使用隔离的 Node `24.18.0` / npm `11.16.0`，依次执行 `npm run verify:env`、`npm run db:migrate`、`npm run seed:fixtures`、`npm run test`、`npm run lint`、`npm run typecheck`、`npm run build` 和 `npm run check`；迁移、seed 和 lockfile 前后无漂移，测试覆盖错误配置、路径安全、59 条 disabled、幂等、SQLite 安全参数、日志脱敏和 health DTO。

## 开发任务开工与完成前置

- 开发部在写代码前必须确认 TASK 已满足 [后续开发派单全局验收硬门](agent-guide.md#后续开发派单全局验收硬门)，并以 [初版全功能追踪矩阵](spec/F1+1-初版全功能追踪矩阵-v0.1.md) 为 Function ID 索引。
- TASK 缺设计版本与 SHA、功能矩阵行、真实入口/状态/失败恢复或 1440/1024/390 深浅主题证据要求时，开发部先 `block` 退回统筹补单；缺视觉锚点时退回设计部，保持代码不动。
- 占位、隐藏调试、DRAFT、静态复制、人工注入、组件预留、`NOT_RUN`、SKIPPED 或 TODO 均不能作为完成证据，相关 Function ID 继续保持 `P1-blocker` 或原用户门禁。

> 注:这里管的是**自动化测试(代码)**。审核层出具的**把关报告**不在 `app/`,见 `docs/collaboration/部门/<审核部门>/把关报告/`(若已启用多会话协作层)。

---
关联:[行为规矩见 agent-guide.md](agent-guide.md) ·[决策记录](decisions/)
