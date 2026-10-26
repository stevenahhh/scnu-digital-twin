/* @vitest-environment jsdom */
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MicroclimatePanel, describeEstimate } from "./MicroclimatePanel.jsx";

// estimate = the GLB extras CityModel copies into the selection (heightLineage, footprintEstimated, formEstimated).
const caption = () => document.querySelector('[data-qa="estimate-caption"]');

afterEach(cleanup);

describe("MicroclimatePanel 추정 caption", () => {
  it("shows the caption for a floors x median height", () => {
    render(<MicroclimatePanel title="학군단" estimate={{ heightLineage: "floors x median", footprintEstimated: false, formEstimated: false }} />);
    expect(caption()).not.toBeNull();
    expect(describeEstimate({ heightLineage: "floors x median" })).toBe(describeEstimate({ heightLineage: "vr-floors x median", footprintEstimated: true }));
  });

  it("has no caption for a GIS height without estimated flags", () => {
    render(<MicroclimatePanel title="공과대학 3호관" estimate={{ heightLineage: "gis-height", footprintEstimated: false, formEstimated: false }} />);
    expect(caption()).toBeNull();
  });

  it("uses the form-only caption when the height is from GIS but the footprint is estimated", () => {
    const formOnly = describeEstimate({ heightLineage: "gis-height", footprintEstimated: true, formEstimated: false });
    expect(formOnly).not.toBeNull();
    expect(formOnly).not.toBe(describeEstimate({ heightLineage: "assumed" }));
  });

  it("has no caption without GLB extras (VWorld or ?model=uni)", () => {
    render(<MicroclimatePanel title="BLD_D4" />);
    expect(caption()).toBeNull();
  });
});
