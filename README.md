# Aggregation Pro

Quartz v5 emitter：将站点级 `configuration.aggregation` 校验、规范化后输出到
`static/aggregation.json`。消费方以该产物为准，不自行解析 YAML。

```yaml
configuration:
  aggregation:
    minGroupSize: 2
    root: { type: folder, depth: 1 }
    branches:
      default: []
      folders:
        任务:
          - { type: field, field: status }
        问答: []
plugins:
  - source: ../plugins-local/aggregation-pro
    enabled: true
    order: 45
```

- `root` 暂时只允许一条 folder 规则，depth 默认为 1。
- 文件的目录按 root.depth 截断得到上下文；如 depth=1，`任务/年度/a.md` 的上下文为 `任务`。
  此时 `任务/年度` 覆盖不会生效；若需要第二层上下文需设置 depth=2。
- 未配置的目录逐层回退，最终使用 default。显式 `[]` 表示停止继承和后续聚合。
- 目录 key 统一为 Quartz slug 路径，规范化后冲突直接报错。`/` 代表根目录。
- minGroupSize 默认 2。graph-pro 在目录分支当前层只要有一类达到阈值，便统一聚合全部类别；否则尝试下一条规则，最终整体散开。本插件不创建图节点。
- 新配置缺失时不输出产物；新配置无效时抛错，禁止静默回退。
- 日期规则必须明确 field 和 granularity，不隐式替换业务字段。

## 产物 v1

`version` 为协议版本；`configHash` 为规范化配置的 SHA-256，不包含内容目录。
`resolved` 为本轮源 Markdown 目录上下文对应的规则链，源文件增删会更新此表。
使用源文件清单而非生成页清单，因此虚拟页不会引入目录上下文。
当前表覆盖扫描到的源 Markdown，是否发布/是否参与某个视图由消费方决定。
相同配置及相同上下文集合产生相同字节，不写 generatedAt。
目录 key 排序，规则数组保持顺序；消费者不能仅凭 configHash 缓存整个产物。

## 阶段范围

graph-pro 已在局部图、全局预计算及运行时展开中消费该协议，首层和后续展开共用分组逻辑。
消费方读取产物，不复制 compiler；大区展示仍由 graph-pro 的 regionRules 控制。
独立插件所用社区 BuildCtx 类型尚无 aggregation，入口用 unknown 后严格校验；
宿主核心 GlobalConfiguration 与 JSON Schema 已同步声明配置结构。

SQLite 配置变更检测本轮不改：只改 YAML 时必须 `--reset`；普通源文件变更用增量命令。
`partialEmit` 从当前源清单重建小型目录表，不全量重写内容索引。

开发：`npm install`、`npm run typecheck`、`npm test`、`npm run build`。
