/** JSON protocol only: no compiler or Node dependencies for consumer plugins. */
export interface FolderAggregationRule {
  type: "folder"
  depth?: number
}

export type AggregationRule = FolderAggregationRule | { type: "field"; field: string }

/**
 * YAML 侧（写进 `configuration.aggregation`）的形状：
 * 文件夹恒为第一层、只暴露层数；字段链写纯字段名。
 * 编译期由 `normalizeAggregation` 转成内部的 `NormalizedAggregationConfiguration`，
 * 产物 `aggregation.json` 结构与下游消费者保持不变。
 */
export interface AggregationConfiguration {
  minGroupSize?: number
  /** 文件夹上下文层数（文件夹恒为第一层，不需要再写 `type: folder`） */
  folderDepth?: number
  branches?: {
    /** 字段名列表，顺序即分组顺序；`[]` 显式停止继承 */
    default?: string[]
    folders?: Record<string, string[]>
  }
}

export interface NormalizedAggregationConfiguration {
  minGroupSize: number
  root: { type: "folder"; depth: number }
  branches: {
    default: AggregationRule[]
    folders: Record<string, AggregationRule[]>
  }
}

export interface AggregationArtifact extends NormalizedAggregationConfiguration {
  version: 1
  /** SHA-256 of normalized configuration; timestamps and content are excluded. */
  configHash: string
  /** Directory context -> resolved chain. [] explicitly disables further grouping. */
  resolved: Record<string, AggregationRule[]>
}
