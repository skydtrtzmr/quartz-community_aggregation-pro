import { describe, expect, it } from "vitest"
import { buildAggregationArtifact, normalizeAggregation, resolveChain } from "../src/compiler"

const status = { type: "field", field: "status" }
const base = { root: { type: "folder", depth: 2 }, branches: { default: [status], folders: {
  "任务": [{ type: "field", field: "owner" }], "任务/特殊任务": [],
} } }

describe("aggregation protocol", () => {
  it("inherits missing directories but preserves explicit disabling", () => {
    const config = normalizeAggregation(base)
    expect(resolveChain(config, "任务/年度任务")).toEqual([{ type: "field", field: "owner" }])
    expect(resolveChain(config, "任务/特殊任务/子目录")).toEqual([])
    expect(resolveChain(config, "人员")).toEqual([status])
  })
  it("is byte stable across configuration key order and source enumeration order", () => {
    const a = buildAggregationArtifact(base, ["任务/年度任务/a", "人员/index", "index"])
    const reordered = { branches: { folders: { "任务/特殊任务": [], "任务": [{ field: "owner", type: "field" }] }, default: [status] }, root: { depth: 2, type: "folder" } }
    const b = buildAggregationArtifact(reordered, ["index", "人员/index", "任务/年度任务/a"])
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
    expect(a.resolved["/"]).toEqual([status])
  })
  it("updates directory membership independently of the configuration hash", () => {
    const a = buildAggregationArtifact(base, ["任务/年度任务/a", "人员/index"])
    const b = buildAggregationArtifact(base, ["任务/年度任务/a", "问答/index"])
    expect(b.configHash).toBe(a.configHash)
    expect(b.resolved).not.toHaveProperty("人员")
    expect(b.resolved).toHaveProperty("问答")
  })
  it("uses root depth for contexts and applies defaults explicitly", () => {
    const a = buildAggregationArtifact({ root: { type: "folder" } }, ["任务/年度任务/a"])
    expect(a.minGroupSize).toBe(2)
    expect(a.root.depth).toBe(1)
    expect(Object.keys(a.resolved)).toEqual(["任务"])
  })
  it.each([
    [{ ...base, typo: true }, "typo"],
    [{ ...base, minGroupSize: 0 }, "minGroupSize"],
    [{ ...base, minGroupSize: 2.5 }, "minGroupSize"],
    [{ root: { type: "folder", depth: 0 } }, "depth"],
    [{ root: { type: "field", field: "status" } }, "root.type"],
    [{ ...base, branches: { default: [{ type: "field" }] } }, "field"],
    [{ ...base, branches: { default: [{ type: "date", field: "date", granularity: "year" }] } }, "expected folder or field"],
    [{ ...base, branches: { default: [{ type: "field", field: "status", granularity: "year" }] } }, "granularity"],
    [{ ...base, branches: { folders: { "任务": null } } }, "expected an array"],
    [{ ...base, branches: { folders: { "../任务": [] } } }, "directory path"],
    [{ ...base, branches: { folders: { "A B": [], "a-b": [] } } }, "duplicate normalized"],
  ])("rejects invalid configuration with a useful path", (value, message) => {
    expect(() => normalizeAggregation(value)).toThrow(String(message))
  })
  it("keeps rule order significant for hashing", () => {
    const rules = [status, { type: "field", field: "date" }]
    const a = buildAggregationArtifact({ ...base, branches: { default: rules } }, [])
    const b = buildAggregationArtifact({ ...base, branches: { default: [...rules].reverse() } }, [])
    expect(a.configHash).not.toBe(b.configHash)
  })
})
