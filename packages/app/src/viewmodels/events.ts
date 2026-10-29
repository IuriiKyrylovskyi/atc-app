/**
 * Comms-log view-model: sim events → the lines the scope's log prints.
 * Events that do not belong in the log (clearances applied, fixes reached, …)
 * give no line.
 */
import type { SimEvent } from '@atc-app/sim';
import { radioCallsign, unable } from '@atc-app/voice';

export type LogKind = 'atc' | 'pilot' | 'unable' | 'error' | 'alert' | 'info';

export interface LogEntryVM {
  /** Sim time, s. */
  t: number;
  kind: LogKind;
  /** Callsign, "ATC", or the alert tag ("CA", "LOS", "SEP"). */
  who: string;
  text: string;
}

export function logEntryFromSim(e: SimEvent): LogEntryVM | null {
  const line = (kind: LogKind, who: string, text: string): LogEntryVM => ({
    t: e.t,
    kind,
    who,
    text,
  });
  switch (e.type) {
    case 'clearance_rejected':
      return line('unable', e.callsign, unable(e.callsign, e.reason).text);
    case 'message_rejected':
      return line('error', e.message.to, e.reason);
    case 'conflict_alert':
      return line(
        'alert',
        'CA',
        `${e.a} / ${e.b} ${e.inS > 0 ? `loss in ${Math.round(e.inS)} s` : 'separation lost'}`
      );
    case 'separation_lost':
      return line(
        'alert',
        'LOS',
        `${e.a} / ${e.b} ${e.lateralNm.toFixed(1)} NM ${Math.round(e.verticalFt)} ft`
      );
    case 'separation_restored': {
      const min = `min ${e.minLateralNm.toFixed(1)} NM / ${Math.round(e.minVerticalFt)} ft`;
      return line(
        'info',
        'SEP',
        `${e.a} / ${e.b} restored after ${Math.round(e.durationS)} s, ${min}`
      );
    }
    case 'localizer_captured':
      return line('info', e.callsign, `established on the localizer ${e.runway}`);
    case 'landed':
      return line('info', e.callsign, `landed ${e.airport} ${e.runway}`);
    case 'missed_approach':
      return line(
        'unable',
        e.callsign,
        `Going around, ${radioCallsign(e.callsign).text} (${e.reason})`
      );
    default:
      return null;
  }
}

/** The log lines of one snapshot's events, in order. */
export const logEntriesFromSim = (events: readonly SimEvent[]): LogEntryVM[] =>
  events.map(logEntryFromSim).filter((l): l is LogEntryVM => l !== null);
