import { useEffect, useRef, useState } from 'react';
import { parseScheduleCsv, appendImportedStops } from './scheduleCsv';

export default function ScheduleImport({ days, onImport }) {
  const dialog = useRef(null);
  const csvInput = useRef(null);
  const [source, setSource] = useState('');
  const [stops, setStops] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    const input = csvInput.current;
    if (input) { input.style.height = 'auto'; input.style.height = `${Math.max(150, input.scrollHeight)}px`; }
  }, [source, stops]);
  useEffect(() => () => dialog.current?.close(), []);
  async function loadFile(event) {
    const file = event.target.files?.[0]; event.target.value = '';
    if (!file) return;
    if (file.size > 500000) { setError('Choose a CSV smaller than 500 KB.'); return; }
    setBusy(true); setError(''); setStops(null);
    try { setSource(await file.text()); } catch { setError('Could not read this file.'); }
    finally { setBusy(false); }
  }
  function review() {
    try { setStops(parseScheduleCsv(source, days)); setError(''); }
    catch (error) { setError(error.message); setStops(null); }
  }
  function confirm() {
    try {
      appendImportedStops(days, stops, () => 'preview');
      onImport(stops);
      dialog.current.close(); setSource(''); setStops(null); setError('');
    } catch (error) { setError(error.message); }
  }
  async function copyInstructions() {
    const prompt = `Convert the attached itinerary into a UTF-8 CSV using the attached template. Return only the CSV file or CSV content, without Markdown fences.
Required headers: day,place,time,duration,note
Use one row per stop. Day is an integer from 1 to ${days.length}, corresponding to these trip dates: ${days.map((day, i) => `${i + 1} = ${day.date}`).join('; ')}.
Use 24-hour HH:MM times. Leave missing times, durations, or notes empty. Keep the itinerary's language. Quote values containing commas, newlines, or quotes; escape quotes by doubling them. Do not invent places or times. Maximum lengths: place 160 characters, duration 80 characters, note 500 characters. Omit the template's example rows. If the itinerary does not match these trip dates, ask me to clarify before producing the CSV.`;
    try { await navigator.clipboard.writeText(prompt); setCopied(true); }
    catch { setError('Clipboard is unavailable. Ask your AI to use the template headers, one stop per row, day numbers starting at 1, and 24-hour times.'); }
  }
  function template() {
    const blob = new Blob(['\uFEFFday,place,time,duration,note\r\n1,Senso-ji Temple,09:00,1 hour,Explore the temple\r\n1,"Lunch, near the station",12:00,1 hour,\r\n'], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob); const link = document.createElement('a');
    link.href = url; link.download = 'trip-schedule-template.csv'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <>
    <button className="outline-btn" onClick={() => { setError(''); dialog.current.showModal(); }}>Import CSV</button>
    <dialog ref={dialog} className="schedule-import-dialog" aria-labelledby="schedule-import-title" onClick={event => { if (event.target === event.currentTarget) dialog.current.close(); }}>
      <header><h3 id="schedule-import-title">Import your schedule</h3><button type="button" className="modal-close" aria-label="Close import" onClick={() => dialog.current.close()}>&#215;</button></header>
      <div className="schedule-import-body">
      <p>Upload a CSV or paste its contents. Use <b>day</b> (1, 2, 3…) or <b>date</b> (YYYY-MM-DD), plus <b>place</b>. Time, duration, and note are optional.</p>
      <div className="schedule-import-actions"><label className="outline-btn">Choose CSV<input type="file" accept=".csv,text/csv" onChange={loadFile} disabled={busy} /></label><button className="outline-btn" onClick={template}>Download template</button><button className="outline-btn" onClick={copyInstructions}>{copied ? "Instructions copied" : "Copy AI instructions"}</button></div>
      <p>Give the template and your itinerary to ChatGPT or another AI, along with the copied instructions. Then upload the completed CSV here and review it.</p>
      {stops ? <button className="outline-btn" onClick={() => setStops(null)}>Edit CSV</button> : <textarea ref={csvInput} aria-label="CSV contents" value={source} onChange={event => { setSource(event.target.value); setStops(null); setError(''); }} placeholder={'day,place,time,duration,note\n1,Senso-ji Temple,09:00,1 hour,Explore the temple'} />}
      {error && <p role="alert" className="import-error">{error}</p>}
      {stops && <section className="schedule-import-preview"><h4>Review {stops.length} stops</h4><p>These stops will be added to your existing plan. Nothing is saved until you confirm.</p>{days.map(day => {
        const items = stops.filter(stop => stop.date === day.date);
        return items.length ? <div key={day.id}><b>{day.date}</b>{items.map((stop, i) => <div className="import-stop" key={i}><time>{stop.time || 'No time'}</time><span>{stop.place}{stop.duration && <small>{stop.duration}</small>}{stop.note && <small>{stop.note}</small>}</span></div>)}</div> : null;
      })}</section>}
      </div>
      <footer><button className="outline-btn" onClick={() => dialog.current.close()}>Cancel</button>{stops ? <button className="primary-btn" onClick={confirm}>Add {stops.length} stops</button> : <button className="primary-btn" disabled={busy || !source.trim()} onClick={review}>Review import</button>}</footer>
    </dialog>
  </>;
}
