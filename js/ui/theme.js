// Gedeelde kleuren en lettertypes voor alles wat op canvas wordt getekend (schermen, pianorol, spectrum).
// Vlak en rustig: één accentkleur, geen gloed of kleurverlopen, gewone zinsletters.
export const ACCENT = '#f29a2e';
export const ACCENT_FILL = 'rgba(242, 154, 46, 0.16)';
export const SECOND = '#7aa7ff';
export const GRID = 'rgba(255, 255, 255, 0.06)';
export const GRID_STRONG = 'rgba(255, 255, 255, 0.14)';
export const LABEL = 'rgba(255, 255, 255, 0.42)';
export const SCREEN_BG = '#111113';
export const font = (size = 10, weight = 500) => `${weight} ${size}px "Archivo Narrow", "Archivo", system-ui, sans-serif`;
