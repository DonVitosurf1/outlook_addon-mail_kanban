import {ask} from './data-settings'
import {UndoSkippable} from './live'

/** Rückmeldung, wenn Rückgängig warten muss, weil gerade eine andere Outlook-Aktion läuft. */
export const BUSY_UNDO='Das Board ist gerade beschäftigt. Bitte gleich noch einmal.'
/** Rückmeldung, wenn die Rücknahme gescheitert ist oder abgebrochen wurde. Der Grund steht in der Meldungszeile. */
export const UNDO_FAILED='Nicht zurückgenommen. Der Schritt bleibt verfügbar.'

/**
 * Rücknahme, die nicht ganz gelingt (`UndoSkippable`): fragt, ob der Schritt übersprungen werden soll, damit er den Stapel nicht blockiert.
 * Andere Fehler wirft sie weiter. Liefert die Meldung für die Statuszeile. Gemeinsam für Board-Rückgängig und Projektdialog.
 */
export async function offerUndoSkip(parent:HTMLElement,error:unknown):Promise<string>{
  if(!(error instanceof UndoSkippable))throw error
  const skip=await ask(parent,error.message+' Diesen Rückgängig-Schritt überspringen und den aktuellen Outlook-Wert behalten?','Schritt überspringen')
  if(skip)error.skip()
  return skip?'Rückgängig-Schritt übersprungen.':'Rücknahme abgebrochen. Der Schritt bleibt verfügbar.'
}
