import { describe, expect, it } from "vitest";
import { UploadStepError, describeUploadFailure, safetyAckText, sendBlockers, shotStageText, sourceButtonText } from "@/lib/capture-status";

const online = { online: true, fileBytes: 700 * 1024 * 1024, maxBytes: 512 * 1024 * 1024 };

describe("describeUploadFailure", () => {
  it("says the connection dropped when the phone is offline", () => {
    expect(describeUploadFailure(new Error("anything"), { online: false }).kind).toBe("offline");
  });

  it("treats a bare network error as a lost connection", () => {
    expect(describeUploadFailure(new TypeError("Failed to fetch"), online).kind).toBe("offline");
    expect(describeUploadFailure(new Error("tus: failed to upload chunk, caused by [object ProgressEvent]"), online).kind)
      .toBe("other");
    expect(describeUploadFailure(new Error("tus: xhr error"), online).kind).toBe("offline");
  });

  it("names the size and the limit for a file that is too big", () => {
    const failure = describeUploadFailure(new UploadStepError("File is larger than allowed.", 413), online);
    expect(failure.kind).toBe("too_large");
    expect(failure.message).toContain("700");
    expect(failure.message).toContain("512");
  });

  it("reads a tus response status", () => {
    const tusError = Object.assign(new Error("tus: unexpected response"), {
      originalResponse: { getStatus: () => 413 },
    });
    expect(describeUploadFailure(tusError, online).kind).toBe("too_large");
  });

  it("recognises an expired session", () => {
    expect(describeUploadFailure(new UploadStepError("Sign in first.", 401), online).kind).toBe("signed_out");
    const tusError = Object.assign(new Error("tus: unexpected response"), {
      originalResponse: { getStatus: () => 401 },
    });
    expect(describeUploadFailure(tusError, online).kind).toBe("signed_out");
  });

  it("passes a server explanation through", () => {
    const failure = describeUploadFailure(new UploadStepError("This prompt has closed.", 409), online);
    expect(failure.kind).toBe("other");
    expect(failure.message).toContain("This prompt has closed.");
  });
});

describe("sendBlockers", () => {
  const ready = { upload: "done" as const, captionRequired: true, oneLiner: "Bus" };

  it("is empty when everything is in place", () => {
    expect(sendBlockers(ready)).toEqual([]);
  });

  it("asks for the caption only when the task requires one", () => {
    expect(sendBlockers({ ...ready, oneLiner: "  " })).toEqual(["Add a one-line caption."]);
    expect(sendBlockers({ ...ready, captionRequired: false, oneLiner: "" })).toEqual([]);
  });

  it("lists every missing piece in order", () => {
    expect(sendBlockers({ upload: "idle", captionRequired: true, oneLiner: "" }))
      .toHaveLength(2);
    expect(sendBlockers({ ...ready, upload: "failed" })[0]).toContain("Try again");
  });
});

describe("safety wording follows the source", () => {
  it("is a promise before shooting and a statement about an existing shot", () => {
    expect(safetyAckText("camera", "video")).toBe("I’ll shoot this safely.");
    expect(safetyAckText("roll", "video")).toBe("This was filmed safely.");
    expect(safetyAckText("roll", "photo")).toBe("This was taken safely.");
    expect(sourceButtonText("camera", "video")).toBe("Record now");
    expect(sourceButtonText("roll", "photo")).toBe("Choose from camera roll");
  });
});

describe("shot stages never overstate", () => {
  it("only the received stage says the desk has it", () => {
    const stages = ["on_phone", "uploading", "uploaded", "sending", "failed"] as const;
    for (const stage of stages) expect(shotStageText(stage, 0.5)).not.toMatch(/received/i);
    expect(shotStageText("received")).toBe("Received by the marketing desk.");
  });

  it("says plainly that an upload alone is not a send", () => {
    expect(shotStageText("uploading", 0.42)).toContain("Not sent to marketing yet");
    expect(shotStageText("uploaded")).toContain("not sent yet");
    expect(shotStageText("on_phone")).toContain("Nothing has been sent");
  });
});
