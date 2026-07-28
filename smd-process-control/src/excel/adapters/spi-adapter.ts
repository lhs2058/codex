import type { ImportParseResult, WorkbookSheet } from "../contracts";
import { parseQualityWorkbook } from "./quality-adapter";
export const parseSpiWorkbook = (sheets: WorkbookSheet[]): ImportParseResult => parseQualityWorkbook(sheets, { kind: "spi", process: "SPI", daily: false, sheet: (name) => name.trim() === "SPI Line" || name.trim() === "spi model" });
