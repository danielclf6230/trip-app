import test from 'node:test';
import assert from 'node:assert/strict';
import { parseScheduleCsv, appendImportedStops } from './scheduleCsv.js';
const days = [{ id: 'd1', date: '2026-10-10', completed: false, items: [] }, { id: 'd2', date: '2026-10-11', completed: false, items: [] }];
test('reads BOM, quoted commas, escaped quotes, multiline notes, and day numbers', () => {
  const stops = parseScheduleCsv('\uFEFFday,place,time,duration,note\r\n1,"Lunch, station",9:30,1h,"Line one\nLine ""two"""', days);
  assert.equal(stops[0].place, 'Lunch, station'); assert.equal(stops[0].time, '09:30');
  assert.equal(stops[0].note, 'Line one\nLine "two"'); assert.equal(stops[0].date, days[0].date);
});
test('rejects invalid dates, times, and malformed CSV without modifying a plan', () => {
  assert.throws(() => parseScheduleCsv('date,place\n2026-10-12,Temple', days));
  assert.throws(() => parseScheduleCsv('day,place,time\n1,Temple,25:00', days));
  assert.throws(() => parseScheduleCsv('day,place\n1,"Temple', days));
});
test('appends only to matching dates and preserves existing stops', () => {
  const existing = { id: 'old', place: 'Hotel', time: '', duration: '', note: '', checked: true };
  const plan = [{ ...days[0], items: [existing] }, days[1]];
  const result = appendImportedStops(plan, parseScheduleCsv('day,place\n1,Temple', days), () => 'new');
  assert.equal(result[0].items.length, 2); assert.equal(result[0].items[0], existing);
  assert.equal(result[0].items[1].checked, false); assert.equal(plan[0].items.length, 1);
  assert.equal(result[1], days[1]);
});
