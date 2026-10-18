export const palette = {
  bgBase: '#0B0E11',
  bgPanel: '#12161B',
  bgElevated: '#1A1F26',
  line: '#232A33',
  textPrimary: '#E8ECEF',
  textMuted: '#8A94A0',
  textDim: '#5A6470',
  accent: '#C8FF3D',
  accentDim: '#8FB32B',
  danger: '#FF4D3D',
  warn: '#FFB020',
  safe: '#3DDC97',
  pitchGreen: '#1A3A2A',
  pitchLine: '#2E5C42',
} as const;

export const riskColor = (risk: string): string => {
  if (risk === 'low') return palette.safe;
  if (risk === 'medium') return palette.warn;
  return palette.danger;
};
