# TASK-20260812-C8CDB9｜M5 / iPhone / iPad 三设备独立身份

## 结论

代码段完成，`decision=pass-code / deployment-successor-required`。Admin production 合同已从精确两个 sourceRef 收窄为精确三个，M5、新 iPhone、旧 iPad 可各持一个互异 43 字符 sourceRef；旧两项、重复项、未知/遗留 `deviceRefs` 继续 fail closed。路由仍复用既有 `includes(sourceRef)`，未增加额外身份实体。

## 产物

- `app/src/server/admin-service/deployment.ts` SHA-256 `d75d0cb1be1b75dd8d6c627dbd80d30e698af96393b2bf151ba6481652b9b75d`。
- `app/src/server/admin-service/server.ts` SHA-256 `41f05b74ac8dfc584c51d25519327a321db6bc6a4781ffc701ff8004cbec9dcc`。
- `app/src/tests/admin-service.test.ts` SHA-256 `c72acc4d410e83f0bf8ab9bd1416686a37c92ab46dda09dbe6ce6ec30807e5cb`。
- `app/ADMIN-SERVICE-PREP.md` SHA-256 `3fa89552be353f39001c03b1f3654d4400f6e30c45e9676ee1e0af15414588ee`。
- owner-only three-device freeze SHA-256 `93df4440a5852b5429f3a8a90f877fafe877bb281f24433365d6ffe5eb1d5be5`；独立 iPad sourceRef SHA-256 `bd2051fb670090cf6d610c4e5a55f4d3309b10fdac6417884c1addfc6bf2eb87`。原值未进入报告或 Git。

selector hashes：M5 `f0b5b950…`、新 iPhone `b8d6cf5c…`、旧 iPad `48ee30ca…`，精确三项且互异；既有 M5/iPhone selector 未漂移。

## 验证（各一次）

- 聚焦 Vitest：`src/tests/admin-service.test.ts`，1 file / 4 tests PASS。
- 固定 Node24 typecheck：PASS，零输出。
- 限定四文件 `git diff --check`：PASS，零输出。

## 最短部署后继输入

当前修改尚未提交，release manifest clean-only 门无法在本任务脏工作树上生成。最短后继顺序：

1. 精确 checkpoint 这四个文件；不包含 scratch、秘密或其他脏改。
2. clean HEAD 聚焦测试/typecheck/diff → production build → M1 target release manifest/verifier。
3. 生成并固化新 M1 release。
4. 把第三个 iPad sourceRef安全加入 M1 PrepareInputs；保持 M5、新 iPhone ref字节不变。
5. 保留旧 prepared Admin 工件作为回退，生成新的隔离 Admin data root或经明确身份门重prepare deployment-v3；trusted identity精确三 ref。
6. Public manifest只在 target release root必须同步时机械prepare；仍保持 disabled。

本任务未 commit/build/release/M1 reprepare，也没有 load、DB、Serve、Grant、Funnel或cutover写。

## mistake-check

- 三台设备没有共用 sourceRef；旧 iPad identity未改。
- schema与server启动门同时改为3，未只改解析一侧。
- 两项与重复项均有聚焦负例。
- 既有 deployment-v3 schema version不增实体；语义仍为同一login/operator下精确三设备。
