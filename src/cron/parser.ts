// ============================================================
// Cron Expression Parser
// ============================================================
// Parsează expresii cron standard 5-câmp:
//   ┌───── minut (0-59)
//   │ ┌─── oră (0-23)
//   │ │ ┌─ zi din lună (1-31)
//   │ │ │ ┌ lună (1-12)
//   │ │ │ │ ┌ zi din săptămână (0-6, 0=Duminică)
//   * * * * *
//
// Suportă: * | număr | listă (1,3,5) | interval (1-5) | pas (*/5)
// Nu are dependențe externe — zero pachete npm.
// ============================================================

export interface CronFields {
  minute: number[];    // [0-59]
  hour: number[];      // [0-23]
  dayOfMonth: number[]; // [1-31]
  month: number[];     // [1-12]
  dayOfWeek: number[]; // [0-6]
}

// Parsează un câmp cron într-o listă de valori numerice
function parseField(field: string, min: number, max: number): number[] {
  const values: number[] = [];

  for (const part of field.split(',')) {
    if (part === '*') {
      // * = toate valorile posibile
      for (let i = min; i <= max; i++) values.push(i);
    } else if (part.includes('/')) {
      // */5 sau 0-30/5 = pas
      const [range, step] = part.split('/');
      const stepNum = parseInt(step);
      const [start, end] = range === '*'
        ? [min, max]
        : range.split('-').map(Number);
      for (let i = start; i <= end; i += stepNum) values.push(i);
    } else if (part.includes('-')) {
      // 1-5 = interval
      const [start, end] = part.split('-').map(Number);
      for (let i = start; i <= end; i++) values.push(i);
    } else {
      // număr simplu
      values.push(parseInt(part));
    }
  }

  return [...new Set(values)].sort((a, b) => a - b);
}

// Parsează expresia completă "* * * * *"
export function parseCron(expression: string): CronFields {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) {
    throw new Error(`Expresie cron invalidă: "${expression}" (trebuie 5 câmpuri)`);
  }

  return {
    minute:     parseField(parts[0], 0, 59),
    hour:       parseField(parts[1], 0, 23),
    dayOfMonth: parseField(parts[2], 1, 31),
    month:      parseField(parts[3], 1, 12),
    dayOfWeek:  parseField(parts[4], 0, 6),
  };
}

// Verifică dacă un moment dat se potrivește cu expresia cron
export function matchesCron(fields: CronFields, date: Date): boolean {
  return (
    fields.minute.includes(date.getMinutes()) &&
    fields.hour.includes(date.getHours()) &&
    fields.dayOfMonth.includes(date.getDate()) &&
    fields.month.includes(date.getMonth() + 1) && // getMonth() e 0-indexed
    fields.dayOfWeek.includes(date.getDay())
  );
}
