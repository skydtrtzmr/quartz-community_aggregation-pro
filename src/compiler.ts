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
 * 顺序即分组顺序；`[]` 显式停止继承。
 */
function fieldChain(value: unknown, path: string): AggregationRule[] {
  if (!Array.isArray(value)) {
    fail(path, "expected an array of field names; use [] to disable further grouping")
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
  for (const [key, value] of Object.entries(folders)) {
    const path = `${base}.branches.folders[${JSON.stringify(key)}]`
    const normalized = directoryKey(key, path)
    if (entries.has(normalized)) fail(path, `duplicate normalized directory: ${normalized}`)
    entries.set(normalized, fieldChain(value, path))
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

export function resolveChain(config: NormalizedAggregationConfiguration, context: string): AggregationRule[] {
  let current = context
  while (current) {
    // Presence, not length: [] must not fall through to a parent rule.
    if (Object.hasOwn(config.branches.folders, current)) return config.branches.folders[current]!
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
