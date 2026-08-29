---
type: department_report
status: final
date: 2026-08-12
department: 开发部
task_id: TASK-20260812-B5FA49
decision: pass
external_calls: 0
---

# B5FA49 Serve app-cap 身份 parser 与 deployment-v3 实现报告

## 结论

`admin-service-deployment-v3` 已固定 `tailscaleAppCapabilityId` 与单行 `trustedIdentities[].sourceRefs`；旧 `deviceRefs` 输入不再被 schema 接受。Admin 静态页、Passkey bootstrap/login 与业务 API 均在统一 `requestEnvelope` 入口先执行 app-cap 闭集 parser，再进入各自 dispatch 分支。

parser 对精确单值可见 ASCII `Tailscale-User-Login`、单值不超过 4096 UTF-8 bytes 的 `Tailscale-App-Capabilities`、唯一目标 capability、唯一只含 43 字符 `sourceRef` 的参数作匹配。遗留 `x-f1-approved-device-ref` 任意出现即返回通用 `ADMIN_SESSION_REQUIRED`，其值不读取。通过匹配后仅向既有 Passkey/session/fresh 链传递脱敏三元组；M5 与 iPhone 两个 source ref 派生不同 `deviceRef`，旧 session 跨 ref 使用被现有绑定门拒绝。

## 冻结产物

- `app/src/server/admin-service/deployment.ts`: `378595f3480f29f6e531846a26e8b64b7924b4cfeaa81ebbc9e18a04acd468e7`
- `app/src/server/admin-service/server.ts`: `65ba5e7a847d5ac2c113d6a85a9504a7530b0f942af915662cd49cbb7072ea83`
- `app/src/server/admin-service/runtime.ts`: `77c7594bc6fea3a60455d370ef7e3cea25883e6bcb08ad83a88431fab8839abd`
- `app/scripts/admin-install-macos.ts`: `0b020fa445e2f327ff3fa78d70aeecb522c330c7fa501f04f7a703f5307312eb`
- `app/scripts/admin-service.ts`: `51e5e1ccc2e94ff00554819b7555b17bcc0991ffd1c1ca17bb793c2be6990ea4`
- `app/src/tests/admin-service.test.ts`: `a2ef392beb93c1a49fad506f426ee2f9e18a7ea89c166591e094fa01e9ce0bb9`
- `app/ADMIN-SERVICE-PREP.md`: `ab98e03b90ae4d87f2bfb508fea18dcdf2ac6d78167e52fde35ad2cac9226582`

现有 release successor 已精确把上述五个运行文件列入 overlay；未新增运行文件，运行闭包继续为 89 项，`release-manifest.ts` 字节保持 `4e452f503f3cb1a71798d45ed2d5c558c8da5cfa440409d14eabf9265e0eee05`。

## 唯一正式验证

1. 聚焦 Vitest 一次：`src/tests/admin-service.test.ts`，1 file / 3 tests PASS。
2. 固定 Node 24 typecheck 一次：PASS，exit 0。
3. 七个目标文件限定 `git diff --check` 一次：PASS，exit 0。

测试覆盖两 ref 不同派生、跨 ref session 拒绝、旧头值不读、缺失/重复/非 ASCII/超长/非法 JSON/未知 capability/未知字段/零参数/多参数/错 login/ref，以及旧 `deviceRefs` schema 拒绝。

## 未验证边界

- 未配置或修改真实 tailnet、Grant、Serve、device approval，也未读取真实 login/source selector/sourceRef。
- 未执行真实浏览器、真机 M5/iPhone、真实 HTTP listener、Passkey 或撤销/重启验证。
- 未 build、未 SSH/M1、未 load LaunchAgent、未写真实 DB、未 cutover。

## 错题自检

未把 app-cap 当作 Passkey 替代品；未信任自定义设备头、X-Forwarded-For、LocalAPI 或公网入口；未记录原始 login/sourceRef；未把代码 PASS 扩大为 tailnet 或生产放行；未覆盖四根解耦与 existing-only 私库边界。

TASK_STATE_OK
