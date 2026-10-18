/**
 * Fictional player names for the synthetic squads. The tracking data only
 * carries ids (NOR-07), so this deterministic roster turns dots into people.
 * Same id always maps to the same name, every match.
 */

const NOR = [
  'T. Hargreaves',
  'D. Osei',
  'L. Fontaine',
  'M. Kovac',
  'J. Lindqvist',
  'S. Park',
  'A. Diallo',
  'R. Bennett',
  'K. Okafor',
  'E. Sorensen',
  'M. Diarra',
];

const RIV = [
  'P. Nwosu',
  'C. Ade',
  'F. Marchetti',
  'O. Bakker',
  'T. Silva',
  'Y. Haddad',
  'G. Rossi',
  'N. Fofana',
  'D. Mensah',
  'L. Petrovic',
  'S. Aguirre',
];

export function playerName(playerId: string): string {
  const [team, num] = playerId.split('-');
  const i = Number(num) - 1;
  if (team === 'NOR') return NOR[i] ?? playerId;
  if (team === 'RIV') return RIV[i] ?? playerId;
  return playerId;
}
