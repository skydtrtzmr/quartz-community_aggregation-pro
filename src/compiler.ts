import { createHash } from "node:crypto"
import { slugifyPath } from "@quartz-community/utils/path"
import type {
  AggregationArtifact,
  AggregationRule,
  NormalizedAggregationConfiguration,
} from "./types"

const base = "configuration.aggregation"

function fail(path: string, message: string): never {
  throw new Error(`[AggregationPro] ${path}: ${message}`)
}

function warn(message: string): void {
  console.warn(`[AggregationPro] ${message}`)
}

function object(value: unknown, path: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail(path, "expected an object")
  }
  return value as Record<string, unknown>
}

function keys(value: Record<string, unknown>, allowed: string[], path: string) {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) fail(`${path}.${key}`, "unknown key")
  }
}

function integer(value: unknown, fallback: number, min: number, path: string): number {
  if (value === undefined) return fallback
  if (typeof value !== "number" || !Number.isInteger(value) || value < min) {
    fail(path, `expected an integer >= ${min}`)
  }
  return value
}

/**
 * 字段链（新写法：纯字段名数组）。编译期转回内部的 `{ type: "field", field }`，
 * 产物 `aggregation.json` 与下游消费者因此零改动。
 * 顺序即分组顺序；空数组等价于「未配置这一层」，继续向上继承（见 normalizeAggregation）。
 */
function fieldChain(value: unknown, path: string): AggregationRule[] {
  if (!Array.isArray(value)) {
    fail(path, "expected an array of field names")
  }
  return value.map((item, index) => {
    const itemPath = `${path}[${index}]`
    if (typeof item !== "string" || !item.trim()) fail(itemPath, "expected a non-empty field name")
    return { type: "field", field: item }
  })
}

// Match Quartz slug spelling; reject traversal rather than interpreting it as inheritance.
function directoryKey(value: string, path: string): string {
  if (value === "/") return "/"
  const clean = value.replaceAll("\\", "/").replace(/^\/+|\/+$/g, "")
  const parts = clean.split("/")
  if (parts.some((part) => !part || part === "." || part === "..")) {
    fail(path, "expected a content-relative directory path")
  }
  const normalized = slugifyPath(clean)
  if (normalized.split("/").some((part) => !part)) fail(path, "directory becomes empty after normalization")
  return normalized
}

export function normalizeAggregation(value: unknown): NormalizedAggregationConfiguration {
  const input = object(value, base)
  keys(input, ["minGroupSize", "folderDepth", "branches"], base)
  const branches = input.branches === undefined ? {} : object(input.branches, `${base}.branches`)
  keys(branches, ["default", "folders"], `${base}.branches`)
  const folders = branches.folders === undefined ? {} : object(branches.folders, `${base}.branches.folders`)
  const entries = new Map<string, AggregationRule[]>()
  // 归一化后的目录键全集：查重用它而不是 entries（空链会被丢弃，不能只看结果表）
  const seen = new Set<string>()
  for (const [key, value] of Object.entries(folders)) {
    const path = `${base}.branches.folders[${JSON.stringify(key)}]`
    const normalized = directoryKey(key, path)
    if (seen.has(normalized)) fail(path, `duplicate normalized directory: ${normalized}`)
    seen.add(normalized)
    const chain = fieldChain(value, path)
    // 目录级只有两态：「配了字段」与「未配置」。空数组不再表示「显式中断聚合」——
    // 直接按未配置丢弃；否则产物里会留下语义为空、却与「键不存在」表现不同的条目
    // （也会污染「读配置 → 回写配置」的往返结果）。
    if (chain.length === 0) {
      warn(`${path} 是空数组，等价于未配置该目录，将逐层向上继承（最终用 ${base}.branches.default）`)
      continue
    }
    entries.set(normalized, chain)
  }
  return {
    // 下限放宽到 1：1 表示「每个取值都成组」。
    // 用于需要「全量可跳转」（每个维度值都有聚合节点 → 都能进维度值页）的场景，
    // 与维度页「全量出页」的口径一致；默认仍是 2（避免小邻域里冒出一堆单成员节点）。
    minGroupSize: integer(input.minGroupSize, 2, 1, `${base}.minGroupSize`),
    // 文件夹恒为第一层，配置只暴露层数；内部仍保留 folder 规则 → 产物与下游消费方零改动
    root: { type: "folder", depth: integer(input.folderDepth, 1, 1, `${base}.folderDepth`) },
    branches: {
      default: branches.default === undefined ? [] : fieldChain(branches.default, `${base}.branches.default`),
      folders: Object.fromEntries([...entries].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)),
    },
  }
}

/**
 * 逐层向上回退取规则链，最终用 `branches.default`。
 *
 * 目录级没有「显式中断」态：`folders` 里的空链在归一化阶段已被丢弃；
 * 这里再按长度兜一层（配置若绕过归一化被外部构造，空链同样视作未配置）。
 */
export function resolveChain(config: NormalizedAggregationConfiguration, context: string): AggregationRule[] {
  let current = context
  while (current) {
    const chain = config.branches.folders[current]
    if (chain && chain.length > 0) return chain
    const slash = current.lastIndexOf("/")
    current = slash > 0 ? current.slice(0, slash) : ""
  }
  return config.branches.default
}

export function buildAggregationArtifact(value: unknown, sourceSlugs: string[]): AggregationArtifact {
  const config = normalizeAggregation(value)
  const contexts = new Set<string>()
  for (const slug of sourceSlugs) {
    // Full slugs retain /index, so a folder index belongs to its own directory.
    const parts = slug.split("/").slice(0, -1)
    contexts.add(parts.slice(0, config.root.depth).join("/") || "/")
  }
  return {
    version: 1,
    configHash: createHash("sha256").update(JSON.stringify(config)).digest("hex"),
    ...config,
    resolved: Object.fromEntries([...contexts].sort().map((context) => [context, resolveChain(config, context)])),
  }
}
