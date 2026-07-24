const DAILY_SHEET_PATTERN = /^\d{2}\.\d{2}$/;

const columnIndex = (letters) =>
  [...letters].reduce((value, letter) => value * 26 + letter.charCodeAt(0) - 64, 0) - 1;

const cellValue = (rows, address) => {
  const match = /^([A-Z]+)(\d+)$/.exec(address);
  if (!match) return null;
  return rows[Number(match[2]) - 1]?.[columnIndex(match[1])] ?? null;
};

const numericCell = (rows, address) => {
  const value = cellValue(rows, address);
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : 0;
};

const toIsoDate = (value, sheetName) => {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const year = value.getUTCFullYear();
    const month = String(value.getUTCMonth() + 1).padStart(2, "0");
    const day = String(value.getUTCDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  if (typeof value === "string") {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime()) && parsed.getUTCFullYear() >= 2000) {
      return `${parsed.getUTCFullYear()}-${String(parsed.getUTCMonth() + 1).padStart(2, "0")}-${String(parsed.getUTCDate()).padStart(2, "0")}`;
    }
  }

  const [day, month] = sheetName.split(".");
  return `${new Date().getFullYear()}-${month}-${day}`;
};

const buildRecord = ({ sheet, data }) => {
  const total = numericCell(data, "D5") || numericCell(data, "G45");
  const present = numericCell(data, "E5") || numericCell(data, "H45");
  const absent = numericCell(data, "F5") || Math.max(total - present, 0);

  if (!total || present > total) {
    throw new Error(`${sheet} 시트에서 총원 또는 출근 인원을 확인할 수 없습니다.`);
  }

  return {
    sheet,
    date: toIsoDate(cellValue(data, "B1"), sheet),
    total,
    present,
    absent,
    rate: Number(((present / total) * 100).toFixed(1)),
    units: [
      {
        name: "ACM V0",
        total: numericCell(data, "F15"),
        present: numericCell(data, "F16"),
      },
      {
        name: "ACM V5",
        total: numericCell(data, "E19"),
        present: numericCell(data, "E20"),
      },
      {
        name: "ACK",
        total: numericCell(data, "F24"),
        present: numericCell(data, "F25"),
      },
    ],
    shifts: {
      dayTotal: numericCell(data, "G30") + numericCell(data, "G37"),
      nightTotal: numericCell(data, "I30") + numericCell(data, "I37"),
      dayAbsent: numericCell(data, "O30") + numericCell(data, "O37"),
      nightAbsent: numericCell(data, "L30") + numericCell(data, "L37"),
    },
    reasons: {
      unplanned: numericCell(data, "I45"),
      approved: numericCell(data, "J45"),
      earlyLeave: numericCell(data, "K45"),
      late: numericCell(data, "L45"),
      maternity: numericCell(data, "M45"),
      transfer: numericCell(data, "N45"),
      resigned: numericCell(data, "O45"),
    },
  };
};

export const parseAttendanceSheets = (sheets) => {
  const dailySheets = sheets.filter(({ sheet }) => DAILY_SHEET_PATTERN.test(sheet));

  if (!dailySheets.length) {
    throw new Error("날짜 형식(예: 23.07)의 근무일 시트를 찾지 못했습니다.");
  }

  const records = dailySheets.map(buildRecord).sort((a, b) => a.date.localeCompare(b.date));
  const uniqueDates = new Set(records.map(({ date }) => date));

  if (uniqueDates.size !== records.length) {
    throw new Error("중복된 날짜가 있어 파일을 업데이트할 수 없습니다.");
  }

  return records;
};
