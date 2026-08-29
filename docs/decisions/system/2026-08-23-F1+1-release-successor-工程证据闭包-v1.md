# F1+1 release successor 工程证据闭包 v1

状态：`successor engineering decision / evidence closure`  
产品状态：不改变 accepted decision；不授权 deploy、M1 或 production。

## 背景

此前 release closure 工作中出现过 `96`、`98`、stale `97` 和 observed `114` 等历史计数。它们来自不同的历史 path-list、旧 assertion 或未冻结的 current-byte preimage，不能混用为当前 release identity。当前 successor 证据必须绑定 path-list 字节、manifest root、causal build、target-stage verifier 和 final focused test 的同一候选。

## 决策

当前 target Admin/Public successor 的唯一 path-set identity 为：

| target | count | sorted path-list SHA-256 | 说明 |
| --- | ---: | --- | --- |
| Admin | 113 | `65108cd552f9302990bf397b1fa6ddfda8347c0b0e46c6b53d6a308640813d21` | current frozen Admin closure |
| Public | 82 | `3bfa3d74898c13576f79de8efde27907a7a5da885af19736adff3d99145587a0` | current frozen Public closure |

两个 path-list 都是 sorted、逐行换行并以末尾换行收束的 canonical bytes。Admin release manifest、Public AST/recorded closure 和 target-stage manifest 必须在同一个 clean tracked single-parent candidate 上通过 verifier。

`app/scripts/public-release-bootstrap.ts` 的分类是 legacy/local synthetic command。该命令可以继续存在于 source tree，供历史或本地 synthetic 流程使用；它不属于当前 target Admin/Public release。Admin/Public manifest contract、Admin build closure、Public AST closure 和 Public projection plist 都必须排除该路径。若 target stage 需要从源码仓库父目录或 bootstrap 脚本补齐字节，则工程门 fail-closed。

## 证据与边界

2026-08-23 successor evidence candidate：

- Git：`HEAD=0c683bcf0e246afe0956b2a28a1ef2c705f7bc2f`，唯一 parent `77477db00fd02be75a1b2f85ac8cc285f26774f7`；tracked status clean；
- Node `24.18.0` / npm `11.16.0`，离线 clean `npm ci`；
- causal Next build exit 0，Next root `6128e702fd0dc6a48167150b389a5a85024632cbc6f0333063a706d8370a38db`，release root `9d1806c5a4512a052812f317ae56062e404f36c7f196f5cecb27be1c8c4c77dd`；
- Admin stage verifier exit 0，Public `preparePublicProjectionDeployment` + `readPublicProjectionDeploymentManifest` exit 0；
- final focused 3-file suite 26/26，RaceFans production-shaped suite 36/36，focused lint 和 full typecheck 均 exit 0；
- target-stage projection service state 固定为 `disabled`。验证使用 disposable Ed25519 test key，`productionSigningKey=false`；没有生产签名授权。

完整报告、机器收据、path-list、release manifest、target-stage receipt 与 hashes 位于：

`[M5-HOME]/Documents/F1+1/scratch/2026-08-23-release-successor-evidence/`

## 验证性修复边界

为了让 Admin 113-path Git fixture 在已有 60s timeout 内完成，本轮只在允许的 `app/src/tests/admin-release-manifest.test.ts` 中将临时 fixture 的 recursive copy 改为 macOS `/bin/cp -cR` clone-copy，并批量复制目录项。没有增加 timeout，没有改变 production runtime、manifest contract 或 deployment behavior；其余 successor 允许文件没有修改。

## 不决策事项

本 ADR 不授权以下行为：production deploy、M1、真实 LaunchAgent、生产密钥、真实外部网络、付费 API、真实数据库/长期服务或外部 publication。没有生产签名密钥时继续 fail-closed；disposable test key 不能被升级为 production key。`docs/spec.md`、`docs/progress.md` 和 `docs/handoff.md` 的本次同步仅追加证据记录，不重写 accepted 正文。
