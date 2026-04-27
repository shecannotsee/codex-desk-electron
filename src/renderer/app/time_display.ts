import { el } from './state_i18n.js';

function padClockPart(value: number): string {
  return String(value).padStart(2, '0');
}

function formatTimezoneOffset(date: Date): string {
  const offsetMinutes = -date.getTimezoneOffset();
  const offsetSign = offsetMinutes >= 0 ? '+' : '-';
  const offsetAbs = Math.abs(offsetMinutes);
  const offsetHours = Math.floor(offsetAbs / 60);
  const offsetRemainMinutes = offsetAbs % 60;
  return `UTC${offsetSign}${padClockPart(offsetHours)}:${padClockPart(offsetRemainMinutes)}`;
}

function formatCurrentClock(date: Date): string {
  return `${date.getFullYear()}-${padClockPart(date.getMonth() + 1)}-${padClockPart(date.getDate())} ${padClockPart(date.getHours())}:${padClockPart(date.getMinutes())}:${padClockPart(date.getSeconds())}`;
}

function renderCurrentTimeDisplay() {
  const now = new Date();
  const clockLabel = formatCurrentClock(now);
  const tzOffsetLabel = formatTimezoneOffset(now);
  const timeZoneName = Intl.DateTimeFormat().resolvedOptions().timeZone || '';

  if (el.currentTimeValue) {
    el.currentTimeValue.textContent = clockLabel;
  }
  if (el.currentTimeChip) {
    el.currentTimeChip.title = timeZoneName ? `${timeZoneName} ${tzOffsetLabel}` : tzOffsetLabel;
  }
}

export {
  formatCurrentClock,
  formatTimezoneOffset,
  renderCurrentTimeDisplay,
};
