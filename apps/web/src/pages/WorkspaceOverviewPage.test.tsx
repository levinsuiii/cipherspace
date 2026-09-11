import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createPersonalVerificationCode,
  createUserCryptoIdentity,
  type LocalUserCryptoIdentity,
  type PublicIdentityBundle
} from "@cipherspace/crypto";

import { localDatabase } from "../local-storage/database";
import { LocalIdentityPinRepository } from "../local-storage/identityPinRepository";
import { WorkspaceOverviewPage } from "./WorkspaceOverviewPage";

const ownerUserId = "00000000-0000-4000-8000-000000000001";
const recipientUserId = "00000000-0000-4000-8000-000000000002";
const otherUserId = "00000000-0000-4000-8000-000000000003";
const requestedEmail = "recipient@example.com";

const mocks = vi.hoisted(() => ({
  addMember: vi.fn(),
  createSignedWorkspaceKeyShare: vi.fn(),
  getInviteeKey: vi.fn(),
  getKey: vi.fn(),
  listMembers: vi.fn(),
  putKeyShare: vi.fn(),
  readLocalUserCryptoIdentity: vi.fn(),
  unlockUserSigningIdentity: vi.fn()
}));

vi.mock("@cipherspace/crypto", async () => {
  const actual = await vi.importActual<typeof import("@cipherspace/crypto")>("@cipherspace/crypto");
  return {
    ...actual,
    createSignedWorkspaceKeyShare: mocks.createSignedWorkspaceKeyShare,
    unlockUserSigningIdentity: mocks.unlockUserSigningIdentity
  };
});

vi.mock("../api/client", () => ({
  api: {
    workspaces: {
      addMember: mocks.addMember,
      getInviteeKey: mocks.getInviteeKey,
      listMembers: mocks.listMembers,
      putKeyShare: mocks.putKeyShare
    }
  }
}));
vi.mock("../auth/AuthContext", () => ({
  useAuth: () => ({
    user: { createdAt: "2026-09-11T00:00:00.000Z", email: "owner@example.com", id: ownerUserId }
  })
}));
vi.mock("../key-management/WorkspaceKeyContext", () => ({
  useWorkspaceKey: () => ({ getKey: mocks.getKey, status: "unlocked" })
}));
vi.mock("../key-management/userIdentity", () => ({
  readLocalUserCryptoIdentity: mocks.readLocalUserCryptoIdentity
}));
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return {
    ...actual,
    Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
    useOutletContext: () => ({
      workspace: {
        createdAt: "2026-09-11T00:00:00.000Z",
        id: "00000000-0000-4000-8000-000000000010",
        name: "Recipient binding test",
        role: "owner",
        updatedAt: "2026-09-11T00:00:00.000Z"
      }
    })
  };
});

let ownerIdentity: LocalUserCryptoIdentity;
let recipientBundle: PublicIdentityBundle;
let substitutedBundle: PublicIdentityBundle;
let otherBundle: PublicIdentityBundle;

beforeAll(async () => {
  const [owner, recipient, substituted, other] = await Promise.all([
    createUserCryptoIdentity("owner identity password", { userId: ownerUserId }),
    createUserCryptoIdentity("recipient identity password", { userId: recipientUserId }),
    createUserCryptoIdentity("substituted identity password", { userId: recipientUserId }),
    createUserCryptoIdentity("other identity password", { userId: otherUserId })
  ]);
  ownerIdentity = owner;
  recipientBundle = recipient.identityBundle!;
  substitutedBundle = substituted.identityBundle!;
  otherBundle = other.identityBundle!;
});

beforeEach(async () => {
  await localDatabase.delete();
  await localDatabase.open();
  vi.clearAllMocks();
  mocks.listMembers.mockResolvedValue({ members: [] });
  mocks.readLocalUserCryptoIdentity.mockResolvedValue(ownerIdentity);
  mocks.unlockUserSigningIdentity.mockResolvedValue({});
  mocks.getKey.mockResolvedValue({});
  mocks.createSignedWorkspaceKeyShare.mockResolvedValue({ protocolVersion: 2 });
  mocks.addMember.mockResolvedValue({});
});

afterAll(async () => {
  await localDatabase.delete();
});

afterEach(() => {
  cleanup();
});

async function pin(bundle: PublicIdentityBundle, email: string) {
  const code = createPersonalVerificationCode(bundle);
  await new LocalIdentityPinRepository(localDatabase, ownerUserId)
    .verifyFromIndependentCode(bundle, code, code, email);
}

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } }
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <WorkspaceOverviewPage />
    </QueryClientProvider>
  );
}

async function submitInvite() {
  renderPage();
  fireEvent.change(screen.getByLabelText("E-Mail eines registrierten Accounts"), {
    target: { value: requestedEmail }
  });
  fireEvent.change(screen.getByLabelText("Account-Passwort für die digitale Signatur"), {
    target: { value: "owner identity password" }
  });
  fireEvent.click(screen.getByRole("button", { name: "Mitglied hinzufügen" }));
}

describe("CS-001 recipient binding", () => {
  it("rejects requested B when the backend returns already-pinned C before key access, wrapping, or upload", async () => {
    await pin(recipientBundle, requestedEmail);
    await pin(otherBundle, "other@example.com");
    mocks.getInviteeKey.mockResolvedValue({
      invitee: { email: requestedEmail, identityBundle: otherBundle, userId: otherUserId }
    });

    await submitInvite();

    expect(await screen.findByText("Die Server-Antwort gehört nicht zum lokal verifizierten Kontakt.")).toBeInTheDocument();
    expect(mocks.getKey).not.toHaveBeenCalled();
    expect(mocks.createSignedWorkspaceKeyShare).not.toHaveBeenCalled();
    expect(mocks.addMember).not.toHaveBeenCalled();
  });

  it("shares with requested B when user ID and pinned fingerprints match", async () => {
    await pin(recipientBundle, requestedEmail);
    mocks.getInviteeKey.mockResolvedValue({
      invitee: { email: requestedEmail, identityBundle: recipientBundle, userId: recipientUserId }
    });

    await submitInvite();

    await waitFor(() => expect(mocks.addMember).toHaveBeenCalledTimes(1));
    expect(mocks.getKey).toHaveBeenCalledTimes(1);
    expect(mocks.createSignedWorkspaceKeyShare).toHaveBeenCalledTimes(1);
    expect(mocks.addMember).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
      userId: recipientUserId
    }));
  });

  it("rejects requested B when the backend substitutes B's fingerprint", async () => {
    await pin(recipientBundle, requestedEmail);
    mocks.getInviteeKey.mockResolvedValue({
      invitee: { email: requestedEmail, identityBundle: substitutedBundle, userId: recipientUserId }
    });

    await submitInvite();

    await waitFor(() => expect(mocks.getInviteeKey).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(mocks.getKey).not.toHaveBeenCalled();
    expect(mocks.createSignedWorkspaceKeyShare).not.toHaveBeenCalled();
    expect(mocks.addMember).not.toHaveBeenCalled();
  });

  it("requires a local verified binding for requested B before key access or wrapping", async () => {
    mocks.getInviteeKey.mockResolvedValue({
      invitee: { email: requestedEmail, identityBundle: recipientBundle, userId: recipientUserId }
    });

    await submitInvite();

    expect(await screen.findByText("Dieser Kontakt wurde auf diesem Gerät noch nicht unabhängig verifiziert.")).toBeInTheDocument();
    expect(mocks.getKey).not.toHaveBeenCalled();
    expect(mocks.createSignedWorkspaceKeyShare).not.toHaveBeenCalled();
    expect(mocks.addMember).not.toHaveBeenCalled();
  });

  it("rejects a repair row whose user ID does not match its locally verified contact", async () => {
    await pin(recipientBundle, requestedEmail);
    mocks.listMembers.mockResolvedValue({
      members: [{
        addedAt: "2026-09-11T00:00:00.000Z",
        email: requestedEmail,
        keyShareStatus: "missing",
        role: "editor",
        userId: otherUserId
      }]
    });

    renderPage();
    await screen.findByText(requestedEmail);
    fireEvent.change(screen.getByLabelText("Account-Passwort für die digitale Signatur"), {
      target: { value: "owner identity password" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Schlüssel teilen" }));

    expect(await screen.findByText("Das ausgewählte Mitglied gehört nicht zum lokal verifizierten Kontakt.")).toBeInTheDocument();
    expect(mocks.getInviteeKey).not.toHaveBeenCalled();
    expect(mocks.getKey).not.toHaveBeenCalled();
    expect(mocks.createSignedWorkspaceKeyShare).not.toHaveBeenCalled();
    expect(mocks.putKeyShare).not.toHaveBeenCalled();
  });
});
