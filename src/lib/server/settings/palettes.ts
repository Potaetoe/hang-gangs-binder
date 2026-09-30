/** The four shipped palettes (DESIGN.md, "The look"). 'auto' is not one
 * of them: it lets the stylesheet follow the device between daylight
 * and midnight. Custom themes are out by design. */

export type Palette = Record<string, string>;

export const PALETTES: Record<string, Palette> = {
	midnight: {
		'color-scheme': 'dark',
		'--color-bg': '#120d10',
		'--color-surface': '#1c1417',
		'--color-accent': '#c73743',
		'--color-on-accent': '#fff7f1',
		'--color-text': '#f1e9e2',
		'--color-text-muted': '#bba9a6',
		'--color-border': '#4a3a40',
		'--color-border-strong': '#7a6870'
	},
	daylight: {
		'color-scheme': 'light',
		'--color-bg': '#f3eadb',
		'--color-surface': '#fbf5ea',
		'--color-accent': '#8e2530',
		'--color-on-accent': '#fbf1e4',
		'--color-text': '#2e2226',
		'--color-text-muted': '#61524b',
		'--color-border': '#d6c6b0',
		'--color-border-strong': '#857567'
	},
	plum: {
		'color-scheme': 'dark',
		'--color-bg': '#241b21',
		'--color-surface': '#322730',
		'--color-accent': '#e87fa8',
		'--color-on-accent': '#2a161f',
		'--color-text': '#f5e6ee',
		'--color-text-muted': '#bfa8b6',
		'--color-border': '#473942',
		'--color-border-strong': '#6f5a66'
	},
	meadow: {
		'color-scheme': 'light',
		'--color-bg': '#f2efe9',
		'--color-surface': '#faf8f4',
		'--color-accent': '#47613f',
		'--color-on-accent': '#f6f4ec',
		'--color-text': '#3a3d35',
		'--color-text-muted': '#6f7165',
		'--color-border': '#ddd8cb',
		'--color-border-strong': '#8f8a77'
	}
};

export const THEME_CHOICES = ['auto', ...Object.keys(PALETTES)];

/** The <style> body that pins a palette, or '' for 'auto'. The doubled
 * :root outranks the stylesheet's base tokens and its dark-mode query
 * whatever order the head loads in. */
export function themeCss(theme: string): string {
	const palette = PALETTES[theme];
	if (!palette) return '';
	const lines = Object.entries(palette)
		.map(([k, v]) => `${k}: ${v};`)
		.join(' ');
	return `:root:root { ${lines} }`;
}
