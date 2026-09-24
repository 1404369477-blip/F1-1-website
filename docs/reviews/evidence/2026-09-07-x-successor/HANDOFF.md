# X 页面候选导入本地后继切片

状态：`PASS_LOCAL_SYNTHETIC_CLONE_IMPORTER_SCOPE / NOT_PRODUCTION_READY / NOT_DEPLOYED`。

本次完成隔离 schema/authority/import 实验；真实 M1 捕获为 0，模型调用为 0，X 新审批/发布为 0。当前源码拒绝 real capture。所有 fixture 都明确标记 synthetic_clone，不代表真实浏览器回执。0013 是未部署的候选迁移，下面的 hash 只钉本地复验身份，未冻结为生产合同。

## 已实现入口

- `app/src/server/x-page/migration.ts::applyXPageCloneMigration(database, manifest)`：只接受无文件位置的内存 SQLite；manifest 必须 `x-page-clone-migration-v1 / synthetic_clone`。输入 schema 必须是精确 0012 指纹。SQL raw SHA、selection SHA、27个来源 identity、临时 schema、外键和输出指纹都校验；DML/DDL 同事务，失败回滚。实际备份恢复的文件数据库会被 `X_PAGE_MIGRATION_CLONE_ONLY` 拒绝。
- `SqliteInternalOperationGateway.transitionQuickLaunchAuthority`：0013 只把 `source_registry_management` 的 schema 改为后继并重置 closed、version递增；原 capability 行完整写入 migration identity，其他 capability 与审计原样。重新开启必须获得真实 gateway authority permit/consume/audit。实验 fixture 用明确的 synthetic supervisor verifier，不冒充实际授权收据。
- `SqliteGatewayMutationPort.mutateSourceRegistry`：X 使用新 `x_page_source_update / admin_http / control / paused / none`；仅 enable/disable/requeue，旧 policy 行不变。source 和 canonical registry 在同一事务同步 enabled/stop_epoch。X retire 提前报 `X_PAGE_RETIRE_SUCCESSOR_REQUIRED`，不生成操作或假装成功。
- `app/src/server/x-page/bridge.ts::importCapturedXPost`：校验捕获摘要与 mandatory verifier，可信 registry 覆盖 PagePost 的 enabled/identity 布尔；作者源与观察源都须当前可用。调用既有 `runAtomicAdmission` + `runTransaction`，仅 `collect / x_page_importer / db_mutation / none`。候选、完整 capture、permit 消耗与成功审计保持同一事务。
- `readXPageSourceIdentity` 供调用者钉 source revision/identity/epochs/stopEpoch；`readXPageCompleteInput(candidateId, expectedRevision/hash)` 只返回当前精确版本全文。RSS refiner 现只查询五个 RSS source ID，不会误把 X excerpt 喂给模型。

导入结果为 created / duplicate / updated。candidate ID独立 xpage 前缀；source_payload_hash使用纯规范化 sourceVersionHash；按作者+status去重。同status异作者拒绝。已见旧版本重放返回duplicate并保留最新revision/hash；从未见过但 observedAt 较旧/相同的不同内容报 X_PAGE_OBSERVATION_STALE。编辑会产生新的不可变 capture，已发布载荷与既有审批记录不被覆盖。候选若已 rejected，导入更新保持 rejected；该兼容分支尚未接到真正X人工审批界面。

每次重复观察使用新的 operationId。当前已成功 operationId 重试 fail closed（不重复写入）；尚无跨进程成功结果重放 API。生产 producer 接入前需补 operationId/requestHash/result receipt 的固定重放语义。

## 保留与检查证据

- 五个 RSS source/feed 映射保持，27个 X source feed_url严格NULL；legacy x_manual_source_registry 59行逐字保留，未选32个 canonical X仍禁用。
- 非空合成RSS历史由既有 `ReviewRealRepository.revision/approve/publish` 在历史schema3上生成，再经过既有迁移至0012。0013前后候选、Bundle、Decision、Publication、outbox逐行相等，外键/完整性通过。
- 现行control、backup/anchor/fence、其余capability逐行不变。此 fixture 的 backup/anchor/fence 和 x_manual_submission 是零行；没有宣称做过真实全量生产历史的克隆演练。
- 独立schema比较：325→342个非空SQL对象，无旧对象缺失；仅6个表和4个trigger按申明修改，其余trigger/index/view SQL完全一致。见 `independent-review/independent-review.json`。
- 开发验证：6文件104项通过（17 importer + 54 normalize + gateway/source-registry/rss-refinement/Sky）；`regression.log`。全 app TypeScript通过，修改文件 ESLint通过，日志 `typecheck.log` / `lint.log`。
- 独立审查：125项不重复验证，另定向复跑最终17项，范围结论 `PASS_LOCAL_SYNTHETIC_CLONE_IMPORTER_SCOPE`。不能把本结论外推成X自动网站链验收。

固定验证命令（工作目录 app）：

```sh
../scratch/toolchains/node-v24.18.0/bin/node node_modules/vitest/vitest.mjs run src/tests/x-page-import.test.ts src/tests/x-page-normalize.test.ts src/tests/internal-operation-gateway.test.ts src/tests/source-registry.test.ts src/tests/rss-refinement.test.ts src/tests/rss-skysports.test.ts --config vitest.config.ts
../scratch/toolchains/node-v24.18.0/bin/node node_modules/typescript/bin/tsc --noEmit
```

## 必须从实验补齐的生产约束

1. **M1真实capture trust入口**：建立受支持Chrome工具连接并钉浏览器实例和host；取得本轮可见DOM的完整正文、绝对time、作者/status/关系和页面URL，保留工具原始回执。当前 PagePost/evidence/hash + caller boolean verifier 都只用于显式合成实验；不能把 literal 改成 real 后复用任意 callback。真实入口须由固定producer/runtime验证回执真实性、instance/host、捕获时间、source config/authorization identity、canonical capture hash，并交付不能由普通调用者制造的已验证凭据或由gateway独立复算的受信任证据引用。缺这些实际输入必须失败，不接受历史URL或手填回执补成功。
2. **来源配置与authority后继**：真实source config必须来自已核实的低频串行调度、adapter/runtime identity和授权有效期，不能由 normalize 成功推导授权、版权或安全状态。本实验rights=unknown/media=blocked，媒体reference只留证，不公开。当前 authority启用仍要求 disabled/stopped/fenced，`source-registry-migration.ts::verifyAuthorityActivationReceipt` 仍钉旧schema10。因此live生产迁移/重新准入需要正式后继流程，不能手工改control/fence，不能仅传新schema参数宣称Admin验证器已接通。0013未生产apply，可在实际样本和合同固定后修订这个候选；一旦任意正式环境apply，之后必须追加迁移，不覆写历史。
3. **生产迁移与backup/runtime**：先完善真实capture类型与信任边界，再固定全部schema/policy/release/backup-reader合同并做真实非空恢复clone。旧schema10/backup运行包继续fail closed。当前gateway增加对 `x-page/schema-identity.ts` 的导入，source registry增加对 `x-page/normalize.ts` 的导入；本次已补齐Admin显式闭包并验证新backup候选闭包。已封存ad57 backup包不受本工作树变化影响。真正生产迁移前先合法暂停相关writer和backup周期，确保新备份解析/恢复/drill接受同一schema11后再恢复调度。当前无生产migration CLI、无release/capability successor、无backup兼容变更。
4. **提炼入口**：把现有 `rss/refinement.ts::refineOneCandidate` 提取为按 candidateId + expected revision/hash工作的受控核心；X只读 `readXPageCompleteInput`。需要新/通用refiner owner和 model_https policy，保留预算、attempt、request hash、失败重试和写前CAS，不能用rss_refiner身份误处理X，不能从preview构造完整输入。当前只隔离旧RSS refiner，没有调用真实模型。
5. **审批/发布/签名公开链**：针对X完整性、身份、有效授权、内容安全、版权/媒体的确定性policy事实绑定同一source revision/full hash；通过 automatic_reviewer/automatic_publisher，保持人工拒绝覆盖保护、bundle/hash/CAS、outbox幂等。现有 ReviewReal schema、PublicDTO、sender/receiver以及 source snapshot 仍封闭RSS，需要完整后继并保持旧RSS签名包可读。当前importer的permit不能写review/publication/projection；没有自动批准成功证据。
6. **实际运行替换**：固定M1现有 scheduled-refine/scheduled-review-publish 和wrapper/runtime hash，明确合法automatic successor的切换与回退；必须机械证明旧manual身份sidecar停止再启新调度，避免重复调用/抢同候选。浏览器工具可交互读取不等于无人值守producer成立。

## 写入范围与交接

`implementation-manifest.json`记录本轮新增/修改文件与完整SHA；`before-hashes.json`和`before/`保留脏工作树的逐文件前置身份；`incremental.patch`仅包含本轮对已有文件的增量，不含早先脏改动。为消除新增静态依赖的打包缺口，本次增量编辑Admin release manifest、prepare-v10/ql3脚本的计数与报告以及release manifest测试。未编辑生产、backup-snapshot/package-binding/恢复登记/fence或deployment实现，也未编辑任务/当前状态/全局进度文档。未提交git，原因是共享工作树有大量预存脏修改且多个核心文件已有变更，需要主控按上述增量审查后统一提交。

## 必需运行包闭包集成

- Admin显式运行清单与critical paths登记实际静态依赖 `x-page/normalize.ts` 和 `x-page/schema-identity.ts`，163→165；路径集合SHA `ea75ad37f82ba55e34281c9a9f84569fdaaa85ba020949e43ddc3280bb92f810`。prepare-v10/ql3计数同步165；ql3报告改为读取合同常量，避免继续输出旧157。
- AST派生闭包实际校验通过：Admin派生158/显式165，Public派生86/显式89。新增X importer、migration和0013 SQL均未进入这两个发布清单。见 `release-closure-proof.json`。
- 新建独立backup runtime候选 `runtime-closure-candidate-new`：prepare和verify均通过，762文件、Node v24.18.0，root SHA `e98bb1576f080c13845d791c3e143febef43185857caba8ee090903bf1225f42`。备份入口实际只依赖新增schema identity，已复制并逐字hash核验；无需引入normalize或clone执行模块。见 `backup-runtime-prepare.json` / `backup-runtime-verify.json`。没有改写既有封存运行包。
- 集成回归13个不重复测试全部取得通过结果，覆盖Admin清单正反例、clean Git release manifest创建/验证、脏Git拒绝、deployment-v10、backup runtime。初跑12过1失败，原因是原固定Node目录只有node、缺少fixture读取的旁邻npm。新建独立 `test-toolchain-node24-npm11.16`，复制同SHA Node24.18.0，并使用官方npm11.16.0完整包（registry SHA512 integrity核验），实际版本与合同一致；此前失败项定向复跑1/1通过。未修改全局npm、原toolchain或测试断言。身份见 `test-toolchain-identity.json`；原始失败与补齐后通过日志分别为 `runtime-closure-tests.log` / `runtime-closure-build-rerun.log`。这是release manifest与封装验证，未据此宣称完成新的生产部署构建。
- 全app TypeScript和4个集成修改文件ESLint通过（`runtime-closure-typecheck.log` / `runtime-closure-lint.log`）。闭包登记保证新工作树引用可封装，没有启用schema11、生产迁移或自动X任务。

独立闭包审查：`PASS_X_DEPENDENCY_RELEASE_CLOSURE_INTEGRATION`，13项不重复集成测试通过；另独立生成同root的762文件backup候选，31个全部本地TS模块（含4个CLI）实际隔离导入通过，导入前后manifest复验一致。报告 `independent-review/release-closure-review.json`，SHA `72301126ba906aab2d7820a358f7b5389cc0028c99f163db84d1f341641b85ca`；无剩余范围内发现。
