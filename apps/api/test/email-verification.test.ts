import { describe, expect, it, vi } from "vitest";

import { ResendEmailVerificationDelivery } from "../src/auth/email-verification.js";

describe("ResendEmailVerificationDelivery", () => {
  it.each([
    ["account verification", "raw_account_verification_token"],
    ["unverified-email reclaim", "raw_email_reclaim_token"]
  ])("sends a fragment-only %s link through Resend", async (_kind, token) => {
    const resendFetch = vi.fn(async () => new Response(null, { status: 200 }));
    const delivery = new ResendEmailVerificationDelivery(
      "re_backend_secret",
      "onboarding@resend.dev",
      "https://app.example.com",
      resendFetch
    );

    await delivery.sendVerification({
      email: "owner@example.com",
      expiresAt: new Date("2026-09-11T12:30:00.000Z"),
      token
    });

    expect(resendFetch).toHaveBeenCalledOnce();
    const [url, init] = resendFetch.mock.calls[0]!;
    expect(url).toBe("https://api.resend.com/emails");
    expect(url).not.toContain("re_backend_secret");
    expect(init?.headers).toMatchObject({ Authorization: "Bearer re_backend_secret" });
    const body = JSON.parse(String(init?.body));
    expect(body).toMatchObject({
      from: "onboarding@resend.dev",
      to: ["owner@example.com"]
    });
    const link = body.text.match(/https:\/\/\S+/u)?.[0];
    expect(link).toBeDefined();
    const verificationUrl = new URL(link!);
    expect(verificationUrl.pathname).toBe("/verify-email");
    expect(verificationUrl.search).toBe("");
    expect(verificationUrl.hash).toBe(`#token=${token}`);
    expect(verificationUrl.href.split("#", 1)[0]).not.toContain(token);
    expect(body.html).toContain(`https://app.example.com/verify-email#token=${token}`);
  });

  it("returns only a generic error when Resend rejects delivery", async () => {
    const delivery = new ResendEmailVerificationDelivery(
      "re_backend_secret",
      "sender@example.com",
      "https://app.example.com",
      vi.fn(async () => new Response("provider detail", { status: 422 }))
    );

    await expect(delivery.sendVerification({
      email: "owner@example.com",
      expiresAt: new Date(),
      token: "secret-token"
    })).rejects.toThrow(/^Email verification delivery failed$/);
  });
});
