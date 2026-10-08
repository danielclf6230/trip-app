export function readCsv(source) {
  const text = source.replace(/^\uFEFF/, '');
  const rows = []; let row = [], field = '', quoted = false, closed = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') { quoted = false; closed = true; }
      else field += c;
    } else if (c === '"') {
      if (field || closed) throw new Error('Unexpected quote in CSV.');
      quoted = true;
    } else if (c === ',' || c === '\n' || c === '\r') {
      row.push(field); field = ''; closed = false;
      if (c !== ',') {
        if (row.some(value => value.trim())) rows.push(row);
        row = [];
        if (c === '\r' && text[i + 1] === '\n') i++;
      }
    } else {
      if (closed && c.trim()) throw new Error('Unexpected text after a quoted CSV value.');
      if (!closed) field += c;
    }
  }
  if (quoted) throw new Error('A quoted CSV value is missing its closing quote.');
  row.push(field);
  if (row.some(value => value.trim())) rows.push(row);
  return rows;
}

export function parseScheduleCsv(source, days) {
  if (source.length > 500000) throw new Error('CSV must be smaller than 500 KB.');
  const [header, ...rows] = readCsv(source);
  if (!header) throw new Error('Choose a CSV with a header and at least one stop.');
  const columns = header.map(value => value.trim().toLowerCase());
  if (new Set(columns).size !== columns.length) throw new Error('CSV headers must be unique.');
  if (!columns.includes('place') || !(columns.includes('date') || columns.includes('day'))) throw new Error('Include place and either date or day columns. Optional columns: time, duration, note.');
  if (!rows.length || rows.length > 500) throw new Error('Import between 1 and 500 stops at a time.');
  return rows.map((row, index) => {
    const line = index + 2;
    if (row.length !== header.length) throw new Error(`Row ${line}: column count does not match the header.`);
    const values = Object.fromEntries(columns.map((name, i) => [name, row[i].trim()]));
    let date = values.date;
    if (!date && values.day) {
      const number = Number(values.day.replace(/^day\s*/i, ''));
      if (!Number.isInteger(number) || number < 1 || number > days.length) throw new Error(`Row ${line}: day must be between 1 and ${days.length}.`);
      date = days[number - 1].date;
    }
    if (!days.some(day => day.date === date)) throw new Error(`Row ${line}: date must match one of this trip's days (YYYY-MM-DD).`);
    if (!values.place || values.place.length > 160) throw new Error(`Row ${line}: place must contain 1–160 characters.`);
    let time = values.time || '';
    if (/^\d:\d{2}$/.test(time)) time = '0' + time;
    if (time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error(`Row ${line}: use a 24-hour time such as 09:30, or leave it empty.`);
    if ((values.duration || '').length > 80 || (values.note || '').length > 500) throw new Error(`Row ${line}: duration or note is too long.`);
    return { date, place: values.place, time, duration: values.duration || '', note: values.note || '' };
  });
}

export function replaceImportedStops(days, stops, makeId) {
  if (stops.some(stop => !days.some(day => day.date === stop.date))) throw new Error('Trip dates changed. Please review the CSV again.');
  return days.map(day => {
    const items = stops.filter(stop => stop.date === day.date).map(stop => ({
      id: makeId(), place: stop.place, time: stop.time, duration: stop.duration,
      note: stop.note, checked: false,
    }));
    return { ...day, completed: false, items };
  });
}
