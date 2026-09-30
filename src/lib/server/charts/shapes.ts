/** Chart geometry, drawn on the server because member pages ship no
 * JavaScript. */

import type { Field } from '../db';
import { round, type Units } from '../units';

/** Points scaled into an SVG polyline. A flat line sits in the middle. */
export function sparklinePoints(points: number[], width = 200, height = 44, pad = 4): string {
	const min = Math.min(...points);
	const max = Math.max(...points);
	const span = max - min;
	const step = (width - pad * 2) / (points.length - 1);
	return points
		.map((p, i) => {
			const x = pad + i * step;
			const y = span === 0 ? height / 2 : height - pad - ((p - min) / span) * (height - pad * 2);
			return `${round(x, 1)},${round(y, 1)}`;
		})
		.join(' ');
}

export const TREND_W = 600;
export const TREND_H = 220;
const TREND_PAD = 14;
const AXIS_GUTTER = 40;

/** A focused trend line, scaled to a shared min and max so the filtered
 * line and the whole-group ghost sit on one axis. */
export function trendPoly(series: number[], min: number, max: number): string {
	const span = max - min;
	const innerW = TREND_W - AXIS_GUTTER - TREND_PAD;
	const step = series.length > 1 ? innerW / (series.length - 1) : 0;
	return series
		.map((v, i) => {
			const x = AXIS_GUTTER + i * step;
			const y =
				span === 0
					? TREND_H / 2
					: TREND_H - TREND_PAD - ((v - min) / span) * (TREND_H - TREND_PAD * 2);
			return `${round(x, 1)},${round(y, 1)}`;
		})
		.join(' ');
}

function niceStep(raw: number): number {
	const power = Math.pow(10, Math.floor(Math.log10(raw)));
	for (const mult of [1, 2, 5, 10]) {
		if (mult * power >= raw) return mult * power;
	}
	return 10 * power;
}

/** Matched widths per measure, so flipping units never reshapes the
 * histogram: 20 lb is about 10 kg, 2 in about 5 cm, BMI bins by 5.
 * Anything else gets round automatic steps. */
export function bucketWidth(field: Field, units: Units): number | null {
	if (field.measure === 'mass') return units === 'imperial' ? 20 : 10;
	if (field.measure === 'length') return units === 'imperial' ? 2 : 5;
	if (field.computed === 'bmi') return 5;
	return null;
}

/** The bar count comes from the data's range, so one absurd stored value
 * must not decide how much the page builds. */
const MAX_BUCKETS = 60;

export function buckets(
	values: number[],
	width: number | null = null,
	target = 7
): { start: number; step: number; counts: number[] } | null {
	if (!values.length) return null;
	const min = Math.min(...values);
	const max = Math.max(...values);
	let step = width ?? (min === max ? 1 : niceStep((max - min) / target));
	// Doubling keeps the steps round: 20 lb, 40 lb, 80 lb.
	while ((max - min) / step >= MAX_BUCKETS) step *= 2;
	const start = Math.floor(min / step) * step;
	const count = Math.max(1, Math.floor((max - start) / step) + 1);
	const counts = new Array<number>(count).fill(0);
	for (const v of values) {
		counts[Math.min(count - 1, Math.floor((v - start) / step))] += 1;
	}
	return { start, step, counts };
}
