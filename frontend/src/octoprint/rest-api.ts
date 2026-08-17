import type { CancelObjectEntry, ExcludedRegion } from './push-payloads'

/**
 * Builds the URL a job file is downloaded from
 * @param jobPath - Server path of the job file
 * @returns The download URL, relative to the OctoPrint page
 */
export function jobFileUrl (jobPath: string): string {
  return OctoPrint.files.downloadPath('local', jobPath)
}

/**
 * Fetches the regions the Exclude Region plugin currently excludes
 * @returns The excluded regions, null when the plugin does not answer
 */
export async function fetchExcludedRegions (): Promise<ExcludedRegion[] | null> {
  try {
    const response = await OctoPrint.simpleApiGet('excluderegion')
    return response.excluded_regions ?? []
  } catch {
    return null
  }
}

/**
 * Fetches the printable objects the Cancel Object plugin lists
 * @returns The listed objects, null when the plugin does not answer
 */
export async function fetchCancelObjects (): Promise<CancelObjectEntry[] | null> {
  try {
    const response = await OctoPrint.simpleApiCommand('cancelobject', 'objlist')
    return response.list ?? []
  } catch {
    return null
  }
}
