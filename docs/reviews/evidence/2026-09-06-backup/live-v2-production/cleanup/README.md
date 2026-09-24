# 第二批精确清理：执行与独立复核证据

本批清理由主控在三轮真实生产备份核收后执行：M5 于 2026-09-06 17:09:54 UTC 删除 1 个已无用途的手工预检密文；M1 于 17:10:15 UTC 删除 13 个本次隔离实验的大文件。随后独立只读复核通过，详见 [independent-postcheck.json](independent-postcheck.json)。复核没有删除文件、触发 job、读取数据库内容或私钥。

| 主机 | 精确删除文件 | 原分配量（字节） | 执行前后可用空间实测增加（字节） | 实测增加（GiB） |
|---|---:|---:|---:|---:|
| M1 | 13 | 2,949,308,416 | 2,949,279,744 | 2.746731 |
| M5 | 1 | 335,802,368 | 335,785,984 | 0.312725 |

13 + 1 个授权路径均已不存在，父目录和盘点根保留。46 份小证据（原始共 186,599 字节）在本地保存副本与原主机均逐份核对 SHA-256 和大小一致；授权、inventory、执行收据及三轮 capture 的引用绑定也通过检查。可用空间变化来自清理执行收据的前后读数，不能与原分配量混用，也不代表此刻磁盘空闲量。

- `m1-inventory.json` / `m5-inventory.json`：执行前精确元数据清单，包含保留成员及候选身份；历史清单不构成再次删除的指令。
- `m1-authorization.json` / `m5-authorization.json`：已执行操作的授权范围，绑定 manifest 和三轮成功证据。
- `m1-cleanup-receipt.json` / `m5-cleanup-receipt.json`：实际删除、属性、时间、空间读数及保留事实。
- `evidence-manifest.json` / `preserved/`：46 份已保留的小证据及来源 hash；失败尝试与成功隔离预检均按原样保留，不能把失败收据用于生产成功证明。
- `independent-postcheck.json` / `verify-cleanup-readonly.py`：只读独立复核结果及方法。
- `precise-cleanup.py`：主控当时执行工具的审计副本；无需、也不得从本目录再次执行删除。
- [evidence-index.json](evidence-index.json)：56 个原始来源与归档文件的 SHA-256、字节数及脱敏标记。

主机 home 路径替换为 `[M1-HOME]` / `[M5-HOME]`，未复制私钥或数据库。脱敏副本的 hash 可能与原件不同；原授权与收据中保留的交叉引用 hash 对应索引的 `sourceSha256`，归档完整性对应 `evidenceSha256`。脚本中的路径同样脱敏，这些副本仅用于审计。

三轮生产核收见 [independent-acceptance.json](../independent-acceptance.json)。本批清理保留当前 SNAP、M5 两包 cache、独立 rescue、projection、JSON、日志、密钥、目录和业务 release；其余历史目录未完成引用判定，不能据此扩展删除范围。三轮中的 M1 iCloud 附加归档失败与真实 Passkey 恢复未验证仍是明确限制。
