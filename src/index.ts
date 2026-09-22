import fs from "node:fs/promises"
import path from "node:path"
import type { BuildCtx, FilePath, QuartzEmitterPlugin } from "@quartz-community/types"
import { slugifyFilePath } from "@quartz-community/utils/path"
import { buildAggregationArtifact } from "./compiler"
export type { AggregationArtifact, AggregationConfiguration } from "./types"

export const AggregationPro: QuartzEmitterPlugin = () => {
  async function emit(ctx: BuildCtx): Promise<FilePath[]> {
    // Host core adds the input type; the published community type package does not yet include it.
    const config = ctx.cfg.configuration as typeof ctx.cfg.configuration & { aggregation?: unknown }
    if (config.aggregation === undefined) return []
    // allFiles is the source inventory in both full and SQLite builds, excluding generated pages.
    const slugs = ctx.allFiles.filter((file) => file.endsWith(".md")).map((file) => slugifyFilePath(file))
    const artifact = buildAggregationArtifact(config.aggregation, slugs)
    const output = path.join(ctx.argv.output, "static", "aggregation.json") as FilePath
    await fs.mkdir(path.dirname(output), { recursive: true })
    await fs.writeFile(output, JSON.stringify(artifact, null, 2) + "\n", "utf8")
    console.log(`[AggregationPro] ${Object.keys(artifact.resolved).length} contexts -> static/aggregation.json`)
    return [output]
  }
  // Recompile the small directory table from the current inventory on each invoked build.
  // Config-only changes still require --reset because SQLite may skip emitters entirely.
  return { name: "AggregationPro", emit, partialEmit: emit }
}
