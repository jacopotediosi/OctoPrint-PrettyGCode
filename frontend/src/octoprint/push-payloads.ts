/* ---- Printer data ---- */

/** Temperatures read at one moment, by heater name */
export interface PrinterTemperatures {
  /** Moment the temperatures were read, in seconds since the epoch */
  time: number
  /** Actual and target temperature of one heater, each unknown until the printer reports it */
  [heater: string]: { actual: number | null, target: number | null } | number
}

/** Printer state reported by OctoPrint */
export interface PrinterState {
  /** What the printer is doing */
  flags: {
    /** Whether the printer is printing */
    printing: boolean
    /** Whether the print is paused */
    paused: boolean
  }
}

/** OctoPrint current/history data payload */
export interface PrinterDataPayload {
  /** Temperatures read over time, the latest last */
  temps: PrinterTemperatures[]
  /** Job the printer is on */
  job: {
    /** File the job prints */
    file: {
      /** Server path of the file */
      path: string
      /** Upload date of the file, in seconds since the epoch */
      date: number
      /** Size of the file in bytes */
      size: number
    }
  }
  /** State the printer is in */
  state: PrinterState
  /** How far the job has got */
  progress: {
    /** Bytes of the file sent to the printer so far */
    filepos: number
    /** Seconds the printer has been on the job */
    printTime: number
  }
}

/* ---- Plugin messages ---- */

/** Excluded region defined in the Exclude Region plugin, bounding the machine X and Y axes in mm */
export interface ExcludedRegion {
  /** Shape of the region */
  type: 'RectangularRegion' | 'CircularRegion'
  /** Identifier the plugin gives the region */
  id: string
  /** Corner X of a rectangular region */
  x1?: number
  /** Corner Y of a rectangular region */
  y1?: number
  /** Opposite corner X of a rectangular region */
  x2?: number
  /** Opposite corner Y of a rectangular region */
  y2?: number
  /** Center X of a circular region */
  cx?: number
  /** Center Y of a circular region */
  cy?: number
  /** Radius of a circular region */
  r?: number
}

/** Printable object listed by the Cancel Object plugin */
export interface CancelObjectEntry {
  /** Name the gcode marks the object with */
  object: string
  /** Whether the object is cancelled */
  cancelled: boolean
}

/** Message a plugin broadcasts to the OctoPrint clients */
export interface PluginMessagePayload {
  /** Excluded regions the Exclude Region plugin reports */
  excluded_regions?: ExcludedRegion[]
  /** Printable objects the Cancel Object plugin reports */
  objects?: CancelObjectEntry[]
}
