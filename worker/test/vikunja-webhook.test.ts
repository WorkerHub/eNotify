import { describe, expect, it } from "vitest";
import {
  buildVikunjaMessage,
  formatVikunjaDue,
  verifyVikunjaSignature,
} from "../src/services/vikunja-webhook";

const encoder = new TextEncoder();

async function sign(
  secret: string,
  body: string,
  hexCase: "lower" | "upper" = "lower",
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(body));
  const hex = Array.from(new Uint8Array(signature), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  return hexCase === "upper" ? hex.toUpperCase() : hex;
}

const SECRET = "vikunja-test-secret";
const BODY = '{"event_name":"task.overdue","data":{}}';

describe("verifyVikunjaSignature", () => {
  it("accepts the HMAC-SHA256 hex of the raw body", async () => {
    await expect(
      verifyVikunjaSignature(SECRET, await sign(SECRET, BODY), BODY),
    ).resolves.toBe(true);
    // Hex case is not part of the signature material.
    await expect(
      verifyVikunjaSignature(SECRET, await sign(SECRET, BODY, "upper"), BODY),
    ).resolves.toBe(true);
  });

  it("rejects a signature made with another secret", async () => {
    await expect(
      verifyVikunjaSignature(SECRET, await sign("other-secret", BODY), BODY),
    ).resolves.toBe(false);
  });

  it("rejects any body change after signing", async () => {
    const signature = await sign(SECRET, BODY);
    await expect(
      verifyVikunjaSignature(SECRET, signature, `${BODY} `),
    ).resolves.toBe(false);
    await expect(
      verifyVikunjaSignature(SECRET, signature, BODY.replace("overdue", "due")),
    ).resolves.toBe(false);
  });

  it("rejects a missing signature header", async () => {
    await expect(verifyVikunjaSignature(SECRET, null, BODY)).resolves.toBe(
      false,
    );
    await expect(verifyVikunjaSignature(SECRET, undefined, BODY)).resolves.toBe(
      false,
    );
    await expect(verifyVikunjaSignature(SECRET, "", BODY)).resolves.toBe(false);
  });

  it("rejects anything that is not 64 hex characters", async () => {
    const valid = await sign(SECRET, BODY);
    for (const header of [
      "abc",
      valid.slice(0, 63),
      `${valid}0`,
      "z".repeat(64),
      `v2=${valid}`,
    ]) {
      await expect(verifyVikunjaSignature(SECRET, header, BODY)).resolves.toBe(
        false,
      );
    }
    // 64 hex chars, but not the right digest.
    await expect(
      verifyVikunjaSignature(SECRET, "a".repeat(64), BODY),
    ).resolves.toBe(false);
  });

  it("rejects when no secret is configured", async () => {
    await expect(
      verifyVikunjaSignature("", await sign(SECRET, BODY), BODY),
    ).resolves.toBe(false);
  });
});

describe("formatVikunjaDue", () => {
  it("formats in the receiving user's timezone as YYYY-MM-DD HH:mm", () => {
    expect(formatVikunjaDue("2026-11-05T01:30:00Z", "Asia/Shanghai")).toBe(
      "2026-11-05 09:30",
    );
    expect(formatVikunjaDue("2026-11-05T01:30:00Z", "UTC")).toBe(
      "2026-11-05 01:30",
    );
    expect(formatVikunjaDue("2026-11-05T23:30:00Z", "UTC")).toBe(
      "2026-11-05 23:30",
    );
  });

  it("omits the zero value and invalid dates", () => {
    expect(formatVikunjaDue("0001-01-01T00:00:00Z", "UTC")).toBeNull();
    expect(formatVikunjaDue("not-a-date", "UTC")).toBeNull();
    expect(formatVikunjaDue(null, "UTC")).toBeNull();
    expect(formatVikunjaDue("", "UTC")).toBeNull();
  });
});

const BASE_URL = "https://vikunja.example.com";

function reminderData() {
  return {
    task: {
      id: 42,
      title: "买牛奶",
      due_date: "2026-11-05T01:30:00Z",
      project_id: 7,
    },
    user: { id: 1 },
    project: { id: 7, title: "家务" },
    reminder: { reminder: "2026-11-05T00:00:00Z" },
  };
}

describe("buildVikunjaMessage: single task events", () => {
  it("maps task.reminder.fired with due date, project and task link", () => {
    expect(
      buildVikunjaMessage(
        "task.reminder.fired",
        reminderData(),
        BASE_URL,
        "Asia/Shanghai",
      ),
    ).toEqual({
      title: "⏰ 买牛奶",
      body: "项目：家务\n截止：2026-11-05 09:30",
      url: "https://vikunja.example.com/tasks/42",
    });
  });

  it("maps task.overdue with the overdue title", () => {
    const data = reminderData();
    expect(
      buildVikunjaMessage("task.overdue", data, BASE_URL, "Asia/Shanghai"),
    ).toEqual({
      title: "⚠️ 已逾期：买牛奶",
      body: "项目：家务\n截止：2026-11-05 09:30",
      url: "https://vikunja.example.com/tasks/42",
    });
  });

  it("drops the due line for the zero due date", () => {
    const data = reminderData();
    data.task.due_date = "0001-01-01T00:00:00Z";
    expect(
      buildVikunjaMessage("task.reminder.fired", data, BASE_URL, "UTC"),
    ).toEqual({
      title: "⏰ 买牛奶",
      body: "项目：家务",
      url: "https://vikunja.example.com/tasks/42",
    });
  });

  it("carries no url when base_url is empty", () => {
    expect(
      buildVikunjaMessage("task.reminder.fired", reminderData(), "", "UTC"),
    ).toEqual({
      title: "⏰ 买牛奶",
      body: "项目：家务\n截止：2026-11-05 01:30",
      url: undefined,
    });
    expect(
      buildVikunjaMessage("task.overdue", reminderData(), null, "UTC")?.url,
    ).toBeUndefined();
  });

  it("tolerates a missing project by keeping the line empty", () => {
    const data = reminderData();
    delete (data as Record<string, unknown>).project;
    expect(
      buildVikunjaMessage("task.overdue", data, BASE_URL, "UTC")?.body,
    ).toBe("项目：\n截止：2026-11-05 01:30");
  });
});

describe("buildVikunjaMessage: tasks.overdue summary", () => {
  function summaryData(count: number) {
    const projects: Record<string, { id: number; title: string }> = {
      "7": { id: 7, title: "家务" },
      "8": { id: 8, title: "工作" },
    };
    return {
      tasks: Array.from({ length: count }, (_, index) => ({
        id: index + 1,
        title: `任务${index + 1}`,
        project_id: index === 1 ? 8 : index === 0 ? 7 : 99,
      })),
      user: { id: 1 },
      projects,
    };
  }

  it("renders one aggregate message with project names and the base url", () => {
    expect(
      buildVikunjaMessage("tasks.overdue", summaryData(3), BASE_URL, "UTC"),
    ).toEqual({
      title: "⚠️ 3 个任务已逾期",
      body: "· 任务1（家务）\n· 任务2（工作）\n· 任务3",
      url: "https://vikunja.example.com",
    });
  });

  it("keeps 10 lines and replaces the last task with a total when longer", () => {
    const message = buildVikunjaMessage(
      "tasks.overdue",
      summaryData(12),
      BASE_URL,
      "UTC",
    );
    expect(message?.title).toBe("⚠️ 12 个任务已逾期");
    const lines = (message?.body ?? "").split("\n");
    expect(lines).toHaveLength(10);
    expect(lines[8]).toBe("· 任务9");
    expect(lines[9]).toBe("… 等共 12 个");
  });

  it("does not add the total line for exactly 10 tasks", () => {
    const message = buildVikunjaMessage(
      "tasks.overdue",
      summaryData(10),
      BASE_URL,
      "UTC",
    );
    const lines = (message?.body ?? "").split("\n");
    expect(lines).toHaveLength(10);
    expect(lines[9]).toBe("· 任务10");
  });

  it("uses no url when base_url is empty", () => {
    expect(
      buildVikunjaMessage("tasks.overdue", summaryData(2), "", "UTC")?.url,
    ).toBeUndefined();
  });
});

describe("buildVikunjaMessage: ignored input", () => {
  it("returns null for unknown events", () => {
    expect(
      buildVikunjaMessage(
        "task.created",
        { task: { id: 1, title: "x" } },
        BASE_URL,
        "UTC",
      ),
    ).toBeNull();
  });

  it("returns null for incomplete known events", () => {
    expect(
      buildVikunjaMessage("task.reminder.fired", null, "", "UTC"),
    ).toBeNull();
    expect(
      buildVikunjaMessage("task.reminder.fired", {}, "", "UTC"),
    ).toBeNull();
    expect(
      buildVikunjaMessage(
        "task.reminder.fired",
        { task: { id: 1 } },
        "",
        "UTC",
      ),
    ).toBeNull();
    expect(
      buildVikunjaMessage("task.overdue", { task: { title: "x" } }, "", "UTC"),
    ).toBeNull();
    expect(
      buildVikunjaMessage("tasks.overdue", { tasks: [] }, "", "UTC"),
    ).toBeNull();
    expect(
      buildVikunjaMessage("tasks.overdue", { tasks: "nope" }, "", "UTC"),
    ).toBeNull();
  });
});
