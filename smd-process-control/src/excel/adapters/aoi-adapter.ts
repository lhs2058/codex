import type { ImportParseResult, WorkbookSheet } from "../contracts";
import { parseQualityWorkbook } from "./quality-adapter";
export const parseAoiWorkbook = (sheets: WorkbookSheet[]): ImportParseResult => parseQualityWorkbook(sheets, { kind: "aoi", process: "AOI", daily: false, sheet: (name) => /^aoi line$|^aoi model$/i.test(name.trim()) });
