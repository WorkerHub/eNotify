import { beforeEach, describe, expect, it, vi } from "vitest";
import { sendSmtpMail } from "../src/services/email";
import { sendNotifyEmail } from "../src/services/notify/email-notify";
import type { Env } from "../src/types";

vi.mock("../src/services/email", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/services/email")>();
  return {
    ...actual,
    sendSmtpMail: vi.fn(async () => ({ success: true })),
  };
});

const smtpMock = vi.mocked(sendSmtpMail);

const message = {
  title: "Renewal due",
  body: "Your plan expires soon.",
};

// The per-user channel must never touch the global settings/DB path.
const env = {} as Env;

function config(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    to: "recipient@example.com",
    from_name: "eNotify",
    smtp_host: "smtp.example.com",
    smtp_port: "465",
    smtp_username: "user@example.com",
    smtp_password: "test-smtp-password",
    smtp_from: "sender@example.com",
    ...overrides,
  });
}

beforeEach(() => {
  smtpMock.mockClear();
  smtpMock.mockResolvedValue({ success: true });
});

describe("sendNotifyEmail config validation", () => {
  it("requires a recipient", async () => {
    await expect(
      sendNotifyEmail(config({ to: "" }), message, env),
    ).resolves.toEqual({ success: false, error: "Email recipient required" });
    expect(smtpMock).not.toHaveBeenCalled();
  });

  it("rejects a recipient containing header separators", async () => {
    await expect(
      sendNotifyEmail(config({ to: "a@b.com\r\nBcc: c@d.com" }), message, env),
    ).resolves.toEqual({ success: false, error: "Invalid email recipient" });
    expect(smtpMock).not.toHaveBeenCalled();
  });

  it("fails with a clear error when smtp_host is empty, without falling back to the system mailer", async () => {
    for (const host of ["", "   ", undefined]) {
      await expect(
        sendNotifyEmail(config({ smtp_host: host }), message, env),
      ).resolves.toEqual({
        success: false,
        error: "Email channel SMTP not configured",
      });
    }
    expect(smtpMock).not.toHaveBeenCalled();
  });

  it("rejects a non-numeric smtp_port", async () => {
    await expect(
      sendNotifyEmail(config({ smtp_port: "abc" }), message, env),
    ).resolves.toEqual({
      success: false,
      error: "Invalid Email channel SMTP port",
    });
    expect(smtpMock).not.toHaveBeenCalled();
  });

  it("rejects a missing sender", async () => {
    await expect(
      sendNotifyEmail(
        config({ smtp_from: "", smtp_username: "" }),
        message,
        env,
      ),
    ).resolves.toEqual({
      success: false,
      error:
        "Invalid Email channel SMTP sender (set smtp_from or smtp_username)",
    });
    expect(smtpMock).not.toHaveBeenCalled();
  });
});

describe("sendNotifyEmail per-user SMTP send", () => {
  it("sends with the per-user SMTP account and the frozen field mapping", async () => {
    const result = await sendNotifyEmail(
      config({ smtp_port: "465", from_name: ' Alerts "HQ" ' }),
      message,
      env,
    );

    expect(result).toEqual({ success: true });
    expect(smtpMock).toHaveBeenCalledTimes(1);

    const [smtpConfig, options] = smtpMock.mock.calls[0] as unknown as [
      Parameters<typeof sendSmtpMail>[0],
      Parameters<typeof sendSmtpMail>[1],
    ];
    expect(smtpConfig).toEqual({
      host: "smtp.example.com",
      port: 465,
      username: "user@example.com",
      password: "test-smtp-password",
      from: "sender@example.com",
      from_name: ' Alerts "HQ" ',
      secure: true,
    });
    expect(options.to).toBe("recipient@example.com");
    expect(options.fromName).toBe("Alerts HQ");
    expect(options.subject).toBe("Renewal due");
    expect(options.html).toBe(
      "<h2>Renewal due</h2><p>Your plan expires soon.</p>",
    );
  });

  it("falls back to smtp_username for the sender and uses STARTTLS on non-465 ports", async () => {
    await sendNotifyEmail(
      config({ smtp_from: "", smtp_port: "587" }),
      message,
      env,
    );

    const [smtpConfig] = smtpMock.mock.calls[0] as unknown as [
      Parameters<typeof sendSmtpMail>[0],
    ];
    expect(smtpConfig.from).toBe("user@example.com");
    expect(smtpConfig.port).toBe(587);
    expect(smtpConfig.secure).toBe(false);
  });

  it("relays SMTP failures into the channel result", async () => {
    smtpMock.mockResolvedValue({
      success: false,
      error: "SMTP error: auth failed",
    });

    await expect(sendNotifyEmail(config(), message, env)).resolves.toEqual({
      success: false,
      error: "SMTP error: auth failed",
    });
  });
});
