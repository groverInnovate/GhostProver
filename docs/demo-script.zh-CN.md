# 3 分钟评审 Demo 脚本

## 0:00–0:20 — 问题陈述

"AI 编码 Agent 可能会无意中将密钥和个人信息发送到模型 Prompt 中。GhostProver 为企业提供了一个后台合规层，能够在不暴露 Prompt 的前提下，证明 Prompt 是干净的。"

## 0:20–0:45 — 策略展示

打开操作台。

- 展示守护进程已连接。
- 展示当前生效的 SaaS 策略。
- 说明 banking、healthcare、fintech、India KYC 以及企业自定义注册表使用的是不同的敏感数据模式。

## 0:45–1:20 — 阻断风险 Prompt

点击**风险样例**，然后点击**运行扫描**。

说明：

"扫描在推理之前即时完成。这个 Prompt 包含类似 AWS Key 的字符串，GhostProver 会阻断它，并返回模式 ID 与字节偏移量。"

## 1:20–2:10 — 合规证明干净 Prompt

点击**安全样例**，**运行扫描**，再点击**生成证明**。

说明：

"干净的 Prompt 会创建一个后台证明任务。用户工作流可以继续推进，同时守护进程在后台生成 ZK 非包含性证明。"

## 2:10–2:40 — 查看收据

打开**收据**面板。

展示：

- commitment
- storage root
- 启用主网提交时的 tx hash、provider 和 model
- job ID
- 证明数量
- 收据历史

说明：

"操作台使用同一个产品 API。草稿记录让证明运行时的流程保持可观测，但合规工件是 0G 收据：storage root、provider、model 和链上交易。"

## 2:40–3:00 — 总结

"GhostProver 是面向 AI Agent 工作流的合规层：MCP 对接编码 Agent，本地守护进程执行策略，ZK 证明保护隐私，0G 提供最终审计轨迹。"
