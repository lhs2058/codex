import type { ImportParseResult, WorkbookSheet } from "../contracts";
import { parseQualityWorkbook } from "./quality-adapter";
export const parseXrayWorkbook = (sheets: WorkbookSheet[]): ImportParseResult => parseQualityWorkbook(sheets, { kind: "xray", process: "XRAY", daily: true, sheet: (name) => /^x\s*ray$/i.test(name.trim()) });
