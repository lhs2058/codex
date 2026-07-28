import type { ImportParseResult, WorkbookSheet } from "../contracts";
import { parseQualityWorkbook } from "./quality-adapter";
export const parseIctWorkbook = (sheets: WorkbookSheet[]): ImportParseResult => parseQualityWorkbook(sheets, { kind: "ict", process: "ICT", daily: true, sheet: (name) => /^data hs cong doan ict$/i.test(name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/gi, "d").trim()) });
