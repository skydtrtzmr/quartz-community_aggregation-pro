/** JSON protocol only: no compiler or Node dependencies for consumer plugins. */
export interface FolderAggregationRule {
  type: "folder"
  depth?: number
}

export type AggregationRule =
  | FolderAggregationRule
  | { type: "field"; field: string }
  | { type: "date"; field: string; granularity: "year" | "month" | "quarter" }

export interface AggregationConfiguration {
  minGroupSize?: number
  root: FolderAggregationRule
  branches?: {
    default?: AggregationRule[]
    folders?: Record<string, AggregationRule[]>
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
