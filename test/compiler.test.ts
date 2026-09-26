import { describe, expect, it, vi } from "vitest"
import { buildAggregationArtifact, normalizeAggregation, resolveChain } from "../src/compiler"

const status = { type: "field", field: "status" }
const owner = { type: "field", field: "owner" }
/** YAML 侧写法：folderDepth + 纯字段名链；`任务/特殊任务: []` 表示「配了个空链」 */
const base = {
  folderDepth: 2,
  branches: {
    default: ["status"],
    folders: { 任务: ["owner"], "任务/特殊任务": [] },
  },
}

describe("aggregation protocol", () => {
  it("inherits missing directories; an empty chain means unconfigured, not a stop", () => {
    const config = normalizeAggregation(base)
    expect(resolveChain(config, "任务/年度任务")).toEqual([owner])
    // 空数组 = 未配置 → 继续向上继承（先父目录「任务」，再 default）
    expect(resolveChain(config, "任务/特殊任务")).toEqual([owner])
    expect(resolveChain(config, "任务/特殊任务/子目录")).toEqual([owner])
    expect(resolveChain(config, "人员")).toEqual([status])
    // 归一化阶段即丢弃：产物里不存在语义为空的条目
    expect(config.branches.folders).not.toHaveProperty("任务/特殊任务")
  })
  it("warns for an empty chain and keeps the rest of the configuration", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {})
    try {
      const config = normalizeAggregation(base)
      expect(spy).toHaveBeenCalledTimes(1)
      expect(String(spy.mock.calls[0]?.[0])).toContain("等价于未配置该目录")
      expect(resolveChain(config, "人员")).toEqual([status])
    } finally {
      spy.mockRestore()
    }
  })
  it("is byte stable across configuration key order and source enumeration order", () => {
    const a = buildAggregationArtifact(base, ["任务/年度任务/a", "人员/index", "index"])
    const reordered = {
      branches: { folders: { "任务/特殊任务": [], 任务: ["owner"] }, default: ["status"] },
      folderDepth: 2,
    }
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
  it("uses folderDepth for contexts and applies defaults explicitly", () => {
    const a = buildAggregationArtifact({}, ["任务/年度任务/a"])
    expect(a.minGroupSize).toBe(2)
    expect(a.root).toEqual({ type: "folder", depth: 1 })
    expect(Object.keys(a.resolved)).toEqual(["任务"])
  })
  it("still emits the internal folder/field rule shape consumed downstream", () => {
    const a = buildAggregationArtifact({ folderDepth: 2, branches: { default: ["status", "date"] } }, [])
    expect(a.root).toEqual({ type: "folder", depth: 2 })
    expect(a.branches.default).toEqual([status, { type: "field", field: "date" }])
  })
  it.each([
    [{ ...base, typo: true }, "typo"],
    [{ ...base, minGroupSize: 0 }, "minGroupSize"],
    [{ ...base, minGroupSize: 2.5 }, "minGroupSize"],
    [{ ...base, folderDepth: 0 }, "folderDepth"],
    [{ ...base, folderDepth: 1.5 }, "folderDepth"],
    [{ ...base, branches: { default: "status" } }, "expected an array"],
    [{ ...base, branches: { default: [] , folders: { 任务: null } } }, "expected an array"],
    [{ ...base, branches: { default: [""], folders: {} } }, "non-empty field name"],
    [{ ...base, branches: { default: [123], folders: {} } }, "non-empty field name"],
    [{ ...base, branches: { folders: { "../任务": [] } } }, "directory path"],
    [{ ...base, branches: { folders: { "A B": [], "a-b": [] } } }, "duplicate normalized"],
  ])("rejects invalid configuration with a useful path", (value, message) => {
    expect(() => normalizeAggregation(value)).toThrow(String(message))
  })
  it("keeps rule order significant for hashing", () => {
    const a = buildAggregationArtifact({ ...base, branches: { default: ["status", "date"] } }, [])
    const b = buildAggregationArtifact({ ...base, branches: { default: ["date", "status"] } }, [])
    expect(a.configHash).not.toBe(b.configHash)
  })
})
