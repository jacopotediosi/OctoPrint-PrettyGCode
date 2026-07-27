import { emptyBounds } from './parser'
import type { ParsedGcode } from './parser'
import type { ParserColors } from './model-colors'
import type { GcodeParseReply, GcodeParseRequest } from './parser-worker'

/** URL of the gcode parser worker */
const PARSER_WORKER_URL = PLUGIN_BASEURL + 'prettygcode/static/js/pg-gcode-parser-worker.bundle.js'

/** Worker parsing the gcode of the load in flight, if any */
let activeWorker: Worker | null = null

/**
 * Downloads and parses a job's gcode; an empty path yields an empty result
 * @param jobPath - Server path of the job file
 * @param objectTag - Tag of the "@<tag> <name>" object markers
 * @param colors - Colors the parser paints segments with
 * @param g90InfluencesExtruder - Whether G90/G91 also switch the extrusion mode
 * @returns The parsed gcode
 */
export async function loadGcodeFile (jobPath: string, objectTag: string | undefined, colors: ParserColors, g90InfluencesExtruder: boolean): Promise<ParsedGcode> {
  // Drop the load still in flight, superseded by this one
  activeWorker?.terminate()
  activeWorker = null

  // If there is no job path, return an empty result
  if (!jobPath) return { layers: [], bounds: emptyBounds(), slicerNozzleDiameter: null, objectNames: [] } satisfies ParsedGcode

  // The worker resolves relative URLs against its own script, so the download URL is made absolute here
  const fileUrl = new URL(OctoPrint.files.downloadPath('local', jobPath), location.href).href

  // Create the parser worker
  const worker = new Worker(PARSER_WORKER_URL)
  activeWorker = worker

  try {
    // Send the request to the worker
    const request: GcodeParseRequest = { fileUrl, objectTag, colors, g90InfluencesExtruder }
    const reply = await new Promise<GcodeParseReply>((resolve, reject) => {
      worker.onmessage = ({ data }) => resolve(data)
      worker.onerror = ({ message }) => reject(new Error(message))
      worker.postMessage(request)
    })
    if (!reply.gcode) throw new Error(reply.error)

    // Return the parsed gcode
    return reply.gcode
  } finally {
    // Free the worker as soon as the load ends
    worker.terminate()
    activeWorker = null
  }
}
