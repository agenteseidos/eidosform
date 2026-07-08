// Decisões puras do autosave do builder — extraídas do componente pra serem
// testáveis em vitest (ambiente node), sem infra de teste de componente.

/**
 * O eco do servidor (`setForm(updatedForm)`) só pode ser aplicado se NENHUMA
 * edição local aconteceu depois do snapshot enviado no PATCH. A resposta reflete
 * o estado de quando o save COMEÇOU; aplicá-la sobre um estado mais novo reverte
 * texto digitado durante o voo da requisição (letras "comidas" na digitação).
 */
export function shouldApplyEcho(seqAtBuild: number, currentSeq: number): boolean {
  return currentSeq === seqAtBuild
}

/**
 * Delay do próximo autosave: debounce por inatividade (`idleMs`, re-armado a cada
 * interação) com teto de espera (`maxWaitMs` desde a primeira edição pendente),
 * pra digitação contínua não adiar o save indefinidamente.
 */
export function nextAutosaveDelay(
  now: number,
  firstEditAt: number,
  idleMs: number,
  maxWaitMs: number
): number {
  const remainingUntilCap = maxWaitMs - (now - firstEditAt)
  return Math.max(0, Math.min(idleMs, remainingUntilCap))
}

/** Há revisão local ainda não persistida? (guarda síncrona do timer e do blur) */
export function hasPendingEdits(currentSeq: number, savedSeq: number): boolean {
  return currentSeq > savedSeq
}
