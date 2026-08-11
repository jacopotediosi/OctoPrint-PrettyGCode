import { GcodeParser, type ParsedGcode } from './parser'

/** Gcode parse request */
export interface GcodeParseRequest {
  /** Absolute URL of the gcode file to parse */
  fileUrl: string
  /** Tag of the "@<tag> <name>" object markers */
  objectTag: string | undefined
  /** Whether G90/G91 also switch the extrusion mode */
  g90InfluencesExtruder: boolean
  /** Angle between the belt and the printer gantry in degrees, null for non-belt printers */
  beltPrinterGantryAngle: number | null
}

/** Gcode parse reply */
export interface GcodeParseReply {
  /** The parsed gcode, absent when the parsing failed */
  gcode?: ParsedGcode
  /** Message of the failure that stopped the parsing, if any */
  error?: string
}

/** Worker global scope */
declare const self: {
  onmessage: (event: MessageEvent<GcodeParseRequest>) => void
  postMessage: (reply: GcodeParseReply, transfer?: Transferable[]) => void
}

/**
 * Downloads and parses a gcode file
 * @param request - Gcode parse request to run
 * @returns The parsed gcode
 */
async function parseGcodeFile (request: GcodeParseRequest): Promise<ParsedGcode> {
  const parser = new GcodeParser(request.objectTag, request.g90InfluencesExtruder, request.beltPrinterGantryAngle)

  const response = await fetch(request.fileUrl)
  if (!response.ok) throw new Error(`Gcode download failed with status ${response.status}`)

  if (response.body) {
    const reader = response.body.getReader()
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      parser.parse(value)
    }
    parser.finish()
  }

  return {
    layers: parser.layers,
    bounds: parser.bounds,
    slicerNozzleDiameter: parser.slicerNozzleDiameter,
    slicerFilamentDiameter: parser.slicerFilamentDiameter,
    slicerFilamentDensity: parser.slicerFilamentDensity,
    slicerToolColors: parser.slicerToolColors,
    colorChanges: parser.colorChanges,
    slicerTimeMarks: parser.slicerTimeMarks,
    featureTypes: parser.featureTypes,
    objectNames: parser.objectNames
  } satisfies ParsedGcode
}

/** Answers a gcode parse request, transferring the parsed buffers to the main thread */
self.onmessage = async ({ data }) => {
  try {
    const gcode = await parseGcodeFile(data)

    const buffers: Transferable[] = []
    for (const layer of gcode.layers) {
      buffers.push(layer.vertices.buffer, layer.filePositions.buffer, layer.durations.buffer, layer.travelVertices.buffer, layer.travelSegmentIndices.buffer)
      if (layer.objectIds) buffers.push(layer.objectIds.buffer)
      for (const property of [layer.featureTypeIds, layer.toolIds, layer.colorChangeIds, layer.feedrates, layer.fanSpeeds, layer.temperatures, layer.widths, layer.heights, layer.filamentPerMm]) {
        buffers.push(property.segmentIndices.buffer, property.values.buffer)
      }
    }
    if (gcode.slicerTimeMarks) buffers.push(gcode.slicerTimeMarks.filePositions.buffer, gcode.slicerTimeMarks.elapsedSeconds.buffer)

    self.postMessage({ gcode }, buffers)
  } catch (error) {
    self.postMessage({ error: String(error) })
  }
}
