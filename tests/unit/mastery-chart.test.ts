import { describe, expect, it } from "vitest";
import { renderMasteryChart } from "../../src/services/mastery-chart.js";

describe("mastery chart", () => {
	it("renders a valid PNG without native dependencies", () => {
		const image = renderMasteryChart(
			[
				{ time: 1, points: 100 },
				{ time: 2, points: 250 },
			],
			200,
			120
		);
		expect([...image.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
		expect(image.length).toBeGreaterThan(100);
	});
});
