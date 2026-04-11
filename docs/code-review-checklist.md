# Code Review Checklist

每次审查 src/ 时必须逐项检查的要点。

---

## 一、逻辑闭环

- [ ] 每条代码路径都有明确终态（成功/失败/超时/取消）
- [ ] 无悬空的 Promise（未 await、未 catch、未赋值）
- [ ] 异步操作都有超时或取消机制
- [ ] 资源获取必有对应释放（timer → clearInterval、listener → removeEventListener、slot → release）
- [ ] 状态机每个状态都有出口（pending → sent/failed/cancelled，running → stopped/destroyed）
- [ ] 循环都有终止条件，不可能无限

---

## 二、函数质量

- [ ] 单一职责——一个函数做一件事
- [ ] 参数验证在入口处完成（fail-fast），而非深处才发现
- [ ] 返回类型明确，不返回 `any` 或 `unknown`（除 catch 归一化）
- [ ] 纯函数标注为纯函数（无副作用、无 I/O）
- [ ] 错误路径与正常路径同等对待——错误信息包含上下文（哪个字段、什么值、期望什么）
- [ ] 无"将就"代码——不为了快速解决问题而引入 hack 或 workaround

---

## 三、禁止误导性 Fallback

- [ ] 无效输入必须 throw，不得静默返回默认值或猜测意图
- [ ] `unknown` / `null` 返回值只用于"确实不知道"的情况，不用于"验证失败但不想 throw"
- [ ] switch/if 链必须穷举——有 default 分支且行为明确（throw 或显式注释为何忽略）
- [ ] 没有 `try { ... } catch { return fallbackValue }` 隐藏错误的模式（除非 fallback 是文档化的正确行为）
- [ ] 无 "silent degradation"——功能降级必须有日志或通知机制

---

## 四、可读性与格式

- [ ] 统一 4 空格缩进、单引号、尾逗号（biome 配置）
- [ ] 逻辑块之间有空行分隔
- [ ] section headers `// -----------------------------------------------` 分隔大段
- [ ] 无超长行（120 字符上限）
- [ ] 嵌套 ternary 拆为 if/else 或提取变量
- [ ] 函数体超 40 行考虑拆分
- [ ] 命名自解释——不需要注释来解释"做了什么"，注释只解释"为什么"

---

## 五、禁止无效改动

- [ ] 不为假设的未来需求增加抽象
- [ ] 不重复解决已被上游保证的问题（如已验证的值不需再验证——除非函数是独立纯函数）
- [ ] 不引入只使用一次的 helper/utility
- [ ] 不添加未使用的参数、类型、导出
- [ ] 不为"代码看起来更整齐"而重构正常工作的逻辑
- [ ] 如果之前改错了，回退到正确状态，不层叠修复

---

## 六、安全

- [ ] 用户输入不直接拼入 shell 命令或 SQL（参数化查询、stdin 执行）
- [ ] 临时文件使用 `wx` flag（exclusive create）+ `chmod 600`
- [ ] 文件路径不包含 `..` 穿越（或经过 resolve + 白名单检查）
- [ ] 无正则 DoS 风险（避免嵌套量词 `(a+)+`）
- [ ] AbortSignal / timeout 防止操作无限等待
- [ ] 敏感信息（路径、URL）在日志中截断或脱敏

---

## 七、性能

- [ ] 热路径无不必要的数组复制或对象展开
- [ ] Map/Set 用于 O(1) 查找场景（而非数组 find/filter）
- [ ] 大批量操作有分页/分块（如 attachment 查询 chunk=500）
- [ ] Timer 使用 `.unref()` 不阻止进程退出
- [ ] 无同步 I/O 在热路径上（sync 只允许在启动/一次性操作中）
- [ ] Semaphore/并发控制防止资源耗尽

---

## 八、健壮性与边界

- [ ] `null` / `undefined` / `""` / `0` / `NaN` / `Infinity` 输入都有明确行为
- [ ] Date 操作考虑月溢出（setMonth 后检查 getDate）
- [ ] 数值操作考虑 MAX_SAFE_INTEGER 范围（是否影响实际场景）
- [ ] AbortSignal 三个时机都处理：操作前已 abort、操作中 abort、等待中 abort
- [ ] 并发安全——异步操作之间状态可能变化（发送中被 cancel、destroy 中被调用）
- [ ] Semaphore 不可能死锁（无循环依赖、slot 最终总会释放）

---

## 九、第三方库评估

引入依赖前必须满足全部条件：

- [ ] 库的功能自己实现需要 >100 行且包含复杂算法
- [ ] 库维护活跃（最近 6 个月有发布）
- [ ] 库体积合理（不为一个函数引入 200KB）
- [ ] 库的 API 与项目风格兼容（支持 ESM、TypeScript 类型）
- [ ] 无更简单的原生替代方案

当前项目唯一生产依赖：`@parseaple/typedstream`（BLOB 解码，无原生替代）。

---

## 十、层边界

| 层 | 允许导入 |
|---|---|
| `types/` | 仅 `types/`、`domain/` 的类型 |
| `domain/` | 仅 `domain/`、`types/` |
| `application/` | `application/`、`domain/`、`types/` |
| `infra/` | `infra/`、`domain/`、`types/`、`utils/`、`application/send-port.ts` |
| `utils/` | 无依赖（纯工具） |
| `sdk.ts` | 除 `index.ts` 和 `config.ts` 外的一切 |
| `index.ts` | 一切（public API barrel） |

- [ ] 无跨层具体导入（infra 不直接导入 application class）
- [ ] Port/Adapter 通过接口或结构化类型解耦
- [ ] Domain 层零 I/O、零外部依赖
