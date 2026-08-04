import { deflateSync } from "node:zlib";

export interface ChartPoint {
	time: number;
	points: number;
}

export function renderMasteryChart(points: readonly ChartPoint[], width = 900, height = 420): Buffer {
	if (points.length < 2) throw new Error("INSUFFICIENT_CHART_DATA");
	const pixels = Buffer.alloc(width * height * 4, 0);
	fill(pixels, width, height, 0, 0, width, height, [31, 33, 40, 255]);
	const margin = { left: 64, right: 32, top: 32, bottom: 54 };
	const chartWidth = width - margin.left - margin.right;
	const chartHeight = height - margin.top - margin.bottom;
	for (let i = 0; i <= 4; i++) {
		const y = margin.top + Math.round((chartHeight * i) / 4);
		fill(pixels, width, height, margin.left, y, chartWidth, 1, [74, 78, 92, 255]);
	}
	const min = Math.min(...points.map((p) => p.points));
	const max = Math.max(...points.map((p) => p.points));
	const range = Math.max(1, max - min);
	const coordinates = points.map((point, index) => ({
		x: margin.left + Math.round((chartWidth * index) / (points.length - 1)),
		y: margin.top + chartHeight - Math.round(((point.points - min) / range) * chartHeight),
	}));
	for (let i = 1; i < coordinates.length; i++)
		line(pixels, width, height, coordinates[i - 1]!.x, coordinates[i - 1]!.y, coordinates[i]!.x, coordinates[i]!.y, [88, 101, 242, 255], 4);
	for (const point of coordinates) fill(pixels, width, height, point.x - 4, point.y - 4, 9, 9, [235, 69, 158, 255]);
	return encodePng(pixels, width, height);
}

function fill(buffer: Buffer, width: number, height: number, x: number, y: number, w: number, h: number, color: readonly number[]) {
	for (let py = Math.max(0, y); py < Math.min(height, y + h); py++) for (let px = Math.max(0, x); px < Math.min(width, x + w); px++) setPixel(buffer, width, px, py, color);
}
function setPixel(buffer: Buffer, width: number, x: number, y: number, color: readonly number[]) {
	const offset = (y * width + x) * 4;
	buffer[offset] = color[0]!;
	buffer[offset + 1] = color[1]!;
	buffer[offset + 2] = color[2]!;
	buffer[offset + 3] = color[3]!;
}
function line(buffer: Buffer, width: number, height: number, x0: number, y0: number, x1: number, y1: number, color: readonly number[], thickness: number) {
	const dx = Math.abs(x1 - x0);
	const sx = x0 < x1 ? 1 : -1;
	const dy = -Math.abs(y1 - y0);
	const sy = y0 < y1 ? 1 : -1;
	let error = dx + dy;
	while (true) {
		fill(buffer, width, height, x0 - Math.floor(thickness / 2), y0 - Math.floor(thickness / 2), thickness, thickness, color);
		if (x0 === x1 && y0 === y1) break;
		const e2 = 2 * error;
		if (e2 >= dy) {
			error += dy;
			x0 += sx;
		}
		if (e2 <= dx) {
			error += dx;
			y0 += sy;
		}
	}
}

function encodePng(rgba: Buffer, width: number, height: number): Buffer {
	const raw = Buffer.alloc((width * 4 + 1) * height);
	for (let y = 0; y < height; y++) {
		raw[y * (width * 4 + 1)] = 0;
		rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
	}
	const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
	const header = Buffer.alloc(13);
	header.writeUInt32BE(width, 0);
	header.writeUInt32BE(height, 4);
	header.set([8, 6, 0, 0, 0], 8);
	return Buffer.concat([signature, chunk("IHDR", header), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
function chunk(type: string, data: Buffer): Buffer {
	const name = Buffer.from(type);
	const out = Buffer.alloc(data.length + 12);
	out.writeUInt32BE(data.length, 0);
	name.copy(out, 4);
	data.copy(out, 8);
	out.writeUInt32BE(crc32(Buffer.concat([name, data])), data.length + 8);
	return out;
}
function crc32(buffer: Buffer): number {
	let crc = 0xffffffff;
	for (const byte of buffer) {
		crc ^= byte;
		for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
	}
	return (crc ^ 0xffffffff) >>> 0;
}
