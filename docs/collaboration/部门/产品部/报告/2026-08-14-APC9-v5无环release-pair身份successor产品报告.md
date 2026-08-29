---
type: product_report
status: final
date: 2026-08-14
department: 产品部
task: TASK-APC9
runtime_state: disabled_unchanged
review_input: scratch/TASK-20260814-AUTO-PUBLISH-CONTRACT-REVIEW/security-review-apc8.md
review_input_sha256: 87501099946b12798ab5e6f1db437753a6a6ab58f12752bb7360884f3f8e88a7
decision: first_p1_contract_addressed_pending_apc10
---

# TASK-APC9：v5无环release-pair身份successor产品报告

## 1. 结论

APC8首个P1已在产品合同层修复：删除full/fallback manifest双向嵌入对方最终SHA的要求，禁止任何自向、双向或经pair receipt间接形成的最终SHA递归。构建身份现在是有限、有序、可复算的三domain：

1. 预冻结兼容输入生成`pairContractRoot`，该domain不含任何最终manifest/receipt SHA或release/content root；
2. `full_v5`和`v5_manual_only_fallback`分别独立生成canonical manifest及最终文件SHA，只包含自己的closure、role和共同pairContractRoot；
3. 两份manifest封存后，在两个release closure之外生成canonical `release-pair-receipt-v1`，记录两份最终manifest SHA和两边release/content root；receipt最终SHA由外部task/deployment manifest锚定，不回写任一manifest或receipt自身。

M1需对两边分别完成stage verifier与HTTP/DB smoke，再由独立pair verifier重算compatibility root、两manifest/closure、pair receipt及stage归属。0005入口把外部pair receipt SHA、full manifest SHA和fallback manifest SHA作为不可覆盖输入；post-COMMIT只接受该receipt精确列出的fallback。

本修订没有新增用户产品选择。001/002/v0.1/v0.2保持原字节；runtime继续`disabled`。APC8为first-P1-stop，本文不能把其未裁定维度写成PASS，需等待APC10从头复审。

## 2. 冻结输入

| 输入 | SHA-256 | 状态 |
| --- | --- | --- |
| APC8报告 | `87501099946b12798ab5e6f1db437753a6a6ab58f12752bb7360884f3f8e88a7` | MATCH |
| predecessor ADR 002 | `329b8680d44bc0877abd176ba8f5b104c35c336ca914a22f1f898996ab357a49` | 保持原字节 |
| predecessor合同v0.2 | `a9b2ff909d5e5107f05d1445cbc336d3e7370e3a118f1c9d4cb104d1eb3de0b3` | 保持原字节 |
| APC7产品报告 | `89752f59474c49defbb43fefd060d99ba9ae933626a2be65c4c85cdf1ae69e04` | 历史证据 |
| predecessor ADR 001 | `59302394fe76f9dfbea32ab054b1969ca3b5d0f15bd55ffb09f98520f209a298` | 保持原字节 |
| predecessor合同v0.1 | `633babb5949562b51a8cd57621538ca9d09136e0eb49e7cfd1bc6f73846dd2d7` | 保持原字节 |

APC8已核实项目现行release manifest SHA语义是最终文件完整字节SHA；因此双向嵌入会形成不可构建固定点。本任务接受其证据，不修改现行manifest实现。

## 3. 无环身份合同

### 3.1 compatibility root

closed `pair-contract-input-v1`精确绑定Git commit/tree、0001..0005有序path/SHA及selector root、`user_version=5`和schema fingerprint、operation/fresh/legacy/audit/outbox producer合同、DB opener、fallback capability、collector guard、sender、receiver/last-known-good合同，以及目标Node OS/arch/path/version/binary SHA。

禁止输入任一manifest/receipt/stage/deployment最终SHA、release/content root、时间、随机数和生产DB瞬时inode。公式：

```text
pairContractRoot = SHA-256(UTF8(canonical-json-v1(pair-contract-input-v1)))
```

### 3.2 independent manifests

安全role只有`full_v5|v5_manual_only_fallback`。两份manifest独立复算自己的runtime closure、content root、release root和最终文件SHA；manifest对象中禁止对方SHA、自身SHA、pair receipt SHA、stage/deployment SHA及语义等价别名。构建次序可以并行，不互相等待。

### 3.3 external pair receipt

`release-pair-receipt-v1`为strict closed canonical JSON，记录：generation rule、pairContractRoot、Git/tree、migration selector、schema version/fingerprint、operation/Node root、两个manifest schema/role/SHA和两边content/release root。文件末尾精确一个LF；最终文件SHA只由外部task/deployment manifest持有。

任何manifest重建、closure单字节变化或root变化都废弃旧pair receipt、stage receipts、pair-verifier receipt与deployment permit；生成新文件和新锚，禁止原地回填。

## 4. canonical与文件身份

- UTF-8无BOM、ASCII closed key按byte升序、schema固定array顺序、NFC字符串、JSON safe integer、无额外空白、末尾精确一个LF；
- raw parser在普通对象化前拒绝duplicate key；unknown/missing/implicit default全部拒绝；
- 所有SHA为小写64hex；两role各一，manifest path/dev/inode/SHA/release root互异；
- M1 manifest/pair/stage/pair-verifier文件均要求owner普通文件、mode0600、nlink1、非symlink、绝对realpath；pair/stage receipt位于两个release closure之外；
- verifier用no-follow FD，对比open前lstat、首次/末次fstat与路径复核；FD保持到pair验证或0005 COMMIT/ROLLBACK后。replace/truncate/append/chmod/chown/hardlink/realpath漂移全部拒绝。

## 5. stage、pair verifier与migration入口

1. full在M1隔离恢复副本完成manifest/closure复算、v4→v5、v5 opener和HTTP/DB smoke。
2. fallback在另一隔离副本完成manifest/closure复算、v5 opener、人工HTTP/fresh/outbox sender smoke及internal/system/enter-resume/collector pre-network负例。
3. 两边分别生成`release-stage-verification-v1`，固定role/pair root/manifest-root/compatibility身份、smoke root、隔离DB身份和`productionDatabaseTouched=false`；fallback collector `externalCalls=0`。
4. 独立pair verifier以外部expected SHA重算两manifest、receipt和stage归属，输出外部锚定的`release-pair-stage-verification-v1` PASS receipt。
5. production deployment manifest closed记录三个核心expected SHA、全部路径、stage/pair-verifier锚、production DB/backup身份且runtime disabled。
6. 0005入口只消费security层生成的不可变授权对象；HTTP/env/请求/自由CLI/release文件均不能覆盖expected SHA。任一漂移发生在COMMIT前则事务ROLLBACK并证明DB仍v4。
7. post-COMMIT full失败时，只可启动同一pair receipt中SHA精确匹配、role为`v5_manual_only_fallback`的release；仅pairContractRoot相等不够。

## 6. 产物

| 产物 | 作用 |
| --- | --- |
| `docs/decisions/system/2026-08-14-F1+1-条件自动发布v5无环release-pair身份-successor-accepted.md` | accepted 003 identity successor |
| `docs/spec/F1+1-存量优先确定性安全初审与条件自动发布实施合同-v0.3.md` | closed schema、构建次序、stage/migration与PI负例合同 |
| `docs/spec.md` | 将现行权威入口切换到003/v0.3并同步门禁 |
| `docs/progress.md` | 记录APC8 P1修订与runtime未升级 |
| 本报告 | 输入、结论、范围、Unknown和交付身份 |

最终SHA在唯一限定`git diff --check`通过后计算并回报；报告不预写自己的最终SHA。

## 7. 未实现与不确定项

- `pair-contract-input-v1`实际artifact SHA、0005和v5 fingerprint：Unknown/未实现；
- 两份新manifest builder/verifier、pair receipt builder/verifier、stage receipts：未实现；
- production deployment manifest successor与migration不可覆盖授权对象：未实现；
- M1双stage、HTTP/DB smoke、pair verify、backup/quiesce/migration/fallback：未运行；
- APC8未裁定fallback closed union/sender、灾难恢复、writer-lock、backlog/CAS、single-outbox、media和全局RPO门，必须由APC10从头复审；
- 本任务只修产品合同首P1，不能授权app实现、0005、M1部署或runtime enablement。
