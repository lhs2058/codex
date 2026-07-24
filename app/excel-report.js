import { strToU8, zipSync } from "fflate";
import { getTranslation } from "./translations.js";

const escapeXml = (value) =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");

const inlineCell = (ref, value, style = 0) =>
  `<c r="${ref}" t="inlineStr"${style ? ` s="${style}"` : ""}><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`;

const numberCell = (ref, value, style = 5) =>
  `<c r="${ref}"${style ? ` s="${style}"` : ""}><v>${Number(value) || 0}</v></c>`;

const formulaCell = (ref, formula, cachedValue, style = 6) =>
  `<c r="${ref}" s="${style}"><f>${escapeXml(formula)}</f><v>${Number(cachedValue) || 0}</v></c>`;

const row = (index, cells, height = 22) =>
  `<row r="${index}" ht="${height}" customHeight="1">${cells.join("")}</row>`;

const workbookFiles = ({ current, records, sourceName, language = "ko" }) => {
  const t = getTranslation(language);
  const selectedIndex = records.findIndex(({ date }) => date === current.date);
  const trend = records.slice(Math.max(0, selectedIndex - 9), selectedIndex + 1);
  const lastRow = 28 + trend.length;
  const createdAt = new Date().toISOString();

  const sheetRows = [
    row(1, [inlineCell("A1", t.title, 1)], 32),
    row(2, [], 12),
    row(3, [
      inlineCell(
        "A3",
        `${t.baseDate}: ${current.date}  |  ${t.dataSource}: ${sourceName}`,
        7,
      ),
    ]),
    row(5, [
      inlineCell("A5", t.summaryMetrics, 2),
      inlineCell("D5", t.byUnit, 2),
    ], 26),
    row(6, [
      inlineCell("A6", t.total, 4),
      numberCell("B6", current.total),
      inlineCell("D6", t.organization, 3),
      inlineCell("E6", t.totalShort, 3),
      inlineCell("F6", t.presentShort, 3),
      inlineCell("G6", t.attendanceRate, 3),
    ]),
    row(7, [
      inlineCell("A7", t.present, 4),
      numberCell("B7", current.present),
      inlineCell("D7", current.units[0]?.name || "ACM V0", 4),
      numberCell("E7", current.units[0]?.total),
      numberCell("F7", current.units[0]?.present),
      formulaCell("G7", "IFERROR(F7/E7,0)", current.units[0]?.total ? current.units[0].present / current.units[0].total : 0),
    ]),
    row(8, [
      inlineCell("A8", t.absent, 4),
      formulaCell("B8", "B6-B7", current.absent, 5),
      inlineCell("D8", current.units[1]?.name || "ACM V5", 4),
      numberCell("E8", current.units[1]?.total),
      numberCell("F8", current.units[1]?.present),
      formulaCell("G8", "IFERROR(F8/E8,0)", current.units[1]?.total ? current.units[1].present / current.units[1].total : 0),
    ]),
    row(9, [
      inlineCell("A9", t.attendanceRate, 4),
      formulaCell("B9", "IFERROR(B7/B6,0)", current.total ? current.present / current.total : 0),
      inlineCell("D9", current.units[2]?.name || "ACK", 4),
      numberCell("E9", current.units[2]?.total),
      numberCell("F9", current.units[2]?.present),
      formulaCell("G9", "IFERROR(F9/E9,0)", current.units[2]?.total ? current.units[2].present / current.units[2].total : 0),
    ]),
    row(12, [inlineCell("A12", t.shiftBalance, 2)], 26),
    row(13, [
      inlineCell("A13", t.category, 3),
      inlineCell("B13", t.totalShort, 3),
      inlineCell("C13", t.absentShort, 3),
      inlineCell("D13", t.presentShort, 3),
      inlineCell("E13", t.attendanceRate, 3),
    ]),
    row(14, [
      inlineCell("A14", t.dayShift, 4),
      numberCell("B14", current.shifts.dayTotal),
      numberCell("C14", current.shifts.dayAbsent),
      formulaCell("D14", "B14-C14", current.shifts.dayTotal - current.shifts.dayAbsent, 5),
      formulaCell("E14", "IFERROR(D14/B14,0)", current.shifts.dayTotal ? (current.shifts.dayTotal - current.shifts.dayAbsent) / current.shifts.dayTotal : 0),
    ]),
    row(15, [
      inlineCell("A15", t.nightShift, 4),
      numberCell("B15", current.shifts.nightTotal),
      numberCell("C15", current.shifts.nightAbsent),
      formulaCell("D15", "B15-C15", current.shifts.nightTotal - current.shifts.nightAbsent, 5),
      formulaCell("E15", "IFERROR(D15/B15,0)", current.shifts.nightTotal ? (current.shifts.nightTotal - current.shifts.nightAbsent) / current.shifts.nightTotal : 0),
    ]),
    row(18, [inlineCell("A18", t.reasons, 2)], 26),
    row(19, [
      inlineCell("A19", t.unplanned, 3),
      inlineCell("B19", t.approved, 3),
      inlineCell("C19", t.late, 3),
      inlineCell("D19", t.earlyLeave, 3),
      inlineCell("E19", t.maternity, 3),
      inlineCell("F19", t.transfer, 3),
      inlineCell("G19", t.resigned, 3),
    ]),
    row(20, [
      numberCell("A20", current.reasons.unplanned),
      numberCell("B20", current.reasons.approved),
      numberCell("C20", current.reasons.late),
      numberCell("D20", current.reasons.earlyLeave),
      numberCell("E20", current.reasons.maternity),
      numberCell("F20", current.reasons.transfer),
      numberCell("G20", current.reasons.resigned),
    ]),
    row(23, [
      inlineCell(
        "A23",
        t.browserGenerated,
        7,
      ),
    ]),
    row(26, [inlineCell("A26", t.recentTrend, 2)], 26),
    row(27, [
      inlineCell("A27", t.date, 3),
      inlineCell("B27", t.totalShort, 3),
      inlineCell("C27", t.presentShort, 3),
      inlineCell("D27", t.absentShort, 3),
      inlineCell("E27", t.attendanceRate, 3),
    ]),
    ...trend.map((record, index) => {
      const rowIndex = 28 + index;
      return row(rowIndex, [
        inlineCell(`A${rowIndex}`, record.date, 4),
        numberCell(`B${rowIndex}`, record.total),
        numberCell(`C${rowIndex}`, record.present),
        formulaCell(`D${rowIndex}`, `B${rowIndex}-C${rowIndex}`, record.absent, 5),
        formulaCell(`E${rowIndex}`, `IFERROR(C${rowIndex}/B${rowIndex},0)`, record.total ? record.present / record.total : 0),
      ]);
    }),
  ];

  const worksheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <dimension ref="A1:G${lastRow}"/>
  <sheetViews><sheetView showGridLines="0" workbookViewId="0"/></sheetViews>
  <sheetFormatPr defaultRowHeight="20"/>
  <cols>
    <col min="1" max="1" width="19" customWidth="1"/>
    <col min="2" max="3" width="14" customWidth="1"/>
    <col min="4" max="4" width="18" customWidth="1"/>
    <col min="5" max="7" width="14" customWidth="1"/>
  </cols>
  <sheetData>${sheetRows.join("")}</sheetData>
  <mergeCells count="8">
    <mergeCell ref="A1:G2"/>
    <mergeCell ref="A3:G3"/>
    <mergeCell ref="A5:B5"/>
    <mergeCell ref="D5:G5"/>
    <mergeCell ref="A12:E12"/>
    <mergeCell ref="A18:G18"/>
    <mergeCell ref="A23:G23"/>
    <mergeCell ref="A26:G26"/>
  </mergeCells>
  <pageMargins left="0.4" right="0.4" top="0.5" bottom="0.5" header="0.2" footer="0.2"/>
  <pageSetup orientation="portrait" paperSize="9" fitToWidth="1" fitToHeight="0"/>
</worksheet>`;

  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <numFmts count="1"><numFmt numFmtId="164" formatCode="0.0%"/></numFmts>
  <fonts count="4">
    <font><sz val="11"/><name val="Arial"/></font>
    <font><b/><sz val="19"/><color rgb="FFFFFFFF"/><name val="Arial"/></font>
    <font><b/><sz val="12"/><color rgb="FF16392C"/><name val="Arial"/></font>
    <font><b/><sz val="10"/><color rgb="FFFFFFFF"/><name val="Arial"/></font>
  </fonts>
  <fills count="5">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF16392C"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFD8FF3E"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFEDF4EF"/><bgColor indexed="64"/></patternFill></fill>
  </fills>
  <borders count="2">
    <border><left/><right/><top/><bottom/><diagonal/></border>
    <border><left style="thin"><color rgb="FFDDE3DE"/></left><right style="thin"><color rgb="FFDDE3DE"/></right><top style="thin"><color rgb="FFDDE3DE"/></top><bottom style="thin"><color rgb="FFDDE3DE"/></bottom><diagonal/></border>
  </borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="8">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="2" fillId="3" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>
    <xf numFmtId="0" fontId="3" fillId="2" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyAlignment="1"><alignment vertical="center"/></xf>
    <xf numFmtId="3" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="0" fontId="0" fillId="4" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>
  </cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
  <dxfs count="0"/>
  <tableStyles count="0" defaultTableStyle="TableStyleMedium2" defaultPivotStyle="PivotStyleLight16"/>
</styleSheet>`;

  return {
    "[Content_Types].xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>`),
    "_rels/.rels": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`),
    "docProps/core.xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:title>${escapeXml(t.title)}</dc:title>
  <dc:creator>ACM Attendance Dashboard</dc:creator>
  <cp:lastModifiedBy>ACM Attendance Dashboard</cp:lastModifiedBy>
  <dcterms:created xsi:type="dcterms:W3CDTF">${createdAt}</dcterms:created>
  <dcterms:modified xsi:type="dcterms:W3CDTF">${createdAt}</dcterms:modified>
</cp:coreProperties>`),
    "docProps/app.xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
  <Application>ACM Attendance Dashboard</Application>
</Properties>`),
    "xl/workbook.xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets><sheet name="${escapeXml(t.reportSheet)}" sheetId="1" r:id="rId1"/></sheets>
  <calcPr calcId="191029" calcMode="auto" fullCalcOnLoad="1"/>
</workbook>`),
    "xl/_rels/workbook.xml.rels": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`),
    "xl/styles.xml": strToU8(styles),
    "xl/worksheets/sheet1.xml": strToU8(worksheet),
  };
};

export const buildExcelReportBlob = (data) => {
  const zipped = zipSync(workbookFiles(data), { level: 6 });
  return new Blob([zipped], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
};

export const downloadBlob = (blob, filename) => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

export const downloadExcelReport = (data) => {
  const blob = buildExcelReportBlob(data);
  const suffix = data.language === "vi" ? "bao_cao_di_lam" : "일일_출근_현황";
  downloadBlob(blob, `ACM_${suffix}_${data.current.date}.xlsx`);
};
