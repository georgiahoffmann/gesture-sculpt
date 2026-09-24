export interface MaterialPreset {
  name: string;
  code: string;
  swatch: string;
  color: number;
  roughness: number;
  metalness: number;
}

/** Restored from the first version of the project, unchanged. Selecting one only ever changes appearance, never geometry. */
export const MATERIAL_LIBRARY: MaterialPreset[] = [
  { name: 'POLÍMERO FOSCO', code: 'PLM-01', swatch: '#c9cbcd', color: 0xc2c4c6, roughness: 0.85, metalness: 0.0 },
  { name: 'ALUMÍNIO ESCOVADO', code: 'ALU-04', swatch: '#d8dadd', color: 0xd6d8da, roughness: 0.32, metalness: 1.0 },
  { name: 'CERÂMICA CRUA', code: 'CER-02', swatch: '#e6e0d6', color: 0xe4ded4, roughness: 0.72, metalness: 0.03 },
  { name: 'PLÁSTICO ABS', code: 'ABS-07', swatch: '#2c2e30', color: 0x26282a, roughness: 0.4, metalness: 0.12 },
  { name: 'CONCRETO ARQ.', code: 'CNC-03', swatch: '#a9aaa6', color: 0xa6a7a3, roughness: 0.95, metalness: 0.0 },
];
