import { Resend } from "resend";

import { env, isResendConfigured } from "../env";
import { childLogger } from "../logger";

const log = childLogger("email");

// ── Lazy singleton ─────────────────────────────────────────────────────────────
let _resend: Resend | null = null;

function getClient(): Resend {
  if (!_resend) {
    if (!isResendConfigured()) {
      throw new Error("RESEND_API_KEY is not configured. Add it to your .env file.");
    }
    _resend = new Resend(env.RESEND_API_KEY);
  }
  return _resend;
}

const FROM = env.EMAIL_FROM ?? "Stackfox <onboarding@resend.dev>";

// ── HTML template ──────────────────────────────────────────────────────────────

function baseTemplate(content: string, previewText = ""): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${previewText}</title>
  <style>
    body { margin: 0; padding: 0; background: #0f0f0f; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
    .wrapper { max-width: 600px; margin: 40px auto; background: #1a1a1a; border: 1px solid #2a2a2a; border-radius: 16px; overflow: hidden; }
    .header { background: linear-gradient(135deg, #6c47ff 0%, #3ecfff 100%); padding: 32px 40px; }
    .header-logo { font-size: 22px; font-weight: 700; color: #ffffff; letter-spacing: -0.5px; }
    .header-logo span { opacity: 0.7; }
    .body { padding: 40px; color: #e0e0e0; line-height: 1.7; font-size: 15px; }
    .body h1 { color: #ffffff; font-size: 24px; font-weight: 700; margin: 0 0 16px; }
    .body p { margin: 0 0 16px; color: #b0b0b0; }
    .body p.highlight { color: #e0e0e0; }
    .cta-btn { display: inline-block; margin: 24px 0; padding: 14px 32px; background: linear-gradient(135deg, #6c47ff 0%, #3ecfff 100%); color: #ffffff !important; text-decoration: none; border-radius: 10px; font-weight: 600; font-size: 15px; }
    .code-box { background: #111; border: 1px solid #2a2a2a; border-radius: 8px; padding: 16px 20px; font-family: "Courier New", monospace; font-size: 13px; color: #a78bfa; margin: 16px 0; word-break: break-all; }
    .divider { border: none; border-top: 1px solid #2a2a2a; margin: 32px 0; }
    .footer { padding: 24px 40px; background: #111; color: #555; font-size: 12px; text-align: center; line-height: 1.6; }
    .footer a { color: #6c47ff; text-decoration: none; }
    .badge { display: inline-block; padding: 4px 10px; border-radius: 20px; font-size: 12px; font-weight: 600; background: rgba(108,71,255,0.15); color: #a78bfa; border: 1px solid rgba(108,71,255,0.3); }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="header">
      <div class="header-logo">Stack<span>fox</span></div>
    </div>
    <div class="body">
      ${content}
    </div>
    <div class="footer">
      &copy; ${new Date().getFullYear()} Stackfox &middot; AI-Powered Collaborative IDE<br/>
      <a href="${env.CLIENT_URL}/unsubscribe">Unsubscribe</a>
    </div>
  </div>
</body>
</html>`;
}

// ── sendInviteEmail ────────────────────────────────────────────────────────────

export async function sendInviteEmail(opts: {
  to: string;
  workspaceName: string;
  inviterName: string;
  inviteToken: string;
  role: string;
}): Promise<{ success: boolean; id?: string; error?: string }> {
  if (!isResendConfigured()) {
    log.warn({ to: opts.to }, "Resend not configured — skipping invite email");
    return { success: false, error: "RESEND_API_KEY is not configured in .env" };
  }
  const acceptUrl = `${env.CLIENT_URL}/invite/accept?token=${opts.inviteToken}`;
  const html = baseTemplate(
    `<h1>You are invited to join <em>${opts.workspaceName}</em></h1>
     <p class="highlight"><strong>${opts.inviterName}</strong> invited you to collaborate as a <span class="badge">${opts.role}</span>.</p>
     <p>Stackfox is an AI-powered collaborative IDE with a shared graph of all team activity, built-in conflict detection, and automated AI resolution.</p>
     <a href="${acceptUrl}" class="cta-btn">Accept Invitation</a>
     <p>Or copy this link:</p>
     <div class="code-box">${acceptUrl}</div>
     <hr class="divider" />
     <p>This invite expires in <strong>7 days</strong>. Ignore if you were not expecting this.</p>`,
    `${opts.inviterName} invited you to ${opts.workspaceName}`,
  );
  try {
    const { data, error } = await getClient().emails.send({
      from: FROM,
      to: opts.to,
      subject: `${opts.inviterName} invited you to ${opts.workspaceName} on Stackfox`,
      html,
    });
    if (error) {
      log.error({ error, to: opts.to }, "Failed to send invite email");
      return { success: false, error: error.message };
    }
    log.info({ to: opts.to, workspace: opts.workspaceName }, "Invite email sent");
    return { success: true, id: data?.id };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error({ err, to: opts.to }, "Exception sending invite email");
    return { success: false, error: msg };
  }
}

// ── sendWelcomeEmail ───────────────────────────────────────────────────────────

export async function sendWelcomeEmail(opts: {
  to: string;
  name: string;
}): Promise<void> {
  if (!isResendConfigured()) {
    log.warn({ to: opts.to }, "Resend not configured — skipping welcome email");
    return;
  }
  const firstName = opts.name.split(" ")[0];
  const dashboardUrl = `${env.CLIENT_URL}/dashboard`;
  const html = baseTemplate(
    `<h1>Welcome to Stackfox, ${firstName}! 🚀</h1>
     <p class="highlight">Your AI-powered collaborative IDE is ready. Here is what you can do:</p>
     <ul style="color:#b0b0b0;padding-left:20px;margin:16px 0;">
       <li style="margin-bottom:8px;"><strong style="color:#e0e0e0;">Connect tools</strong> — GitHub, Jira, Slack</li>
       <li style="margin-bottom:8px;"><strong style="color:#e0e0e0;">Explore the graph</strong> — Live team activity as a knowledge graph</li>
       <li style="margin-bottom:8px;"><strong style="color:#e0e0e0;">Invite teammates</strong> — Shared workspace access</li>
       <li style="margin-bottom:8px;"><strong style="color:#e0e0e0;">Detect conflicts</strong> — AI finds and resolves code conflicts automatically</li>
     </ul>
     <a href="${dashboardUrl}" class="cta-btn">Open Dashboard</a>
     <hr class="divider" />
     <p>Questions? Reply to this email — we read every message.</p>`,
    `Welcome to Stackfox, ${firstName}!`,
  );
  try {
    const { error } = await getClient().emails.send({
      from: FROM,
      to: opts.to,
      subject: `Welcome to Stackfox, ${firstName}! 🚀`,
      html,
    });
    if (error) log.error({ error, to: opts.to }, "Failed to send welcome email");
    else log.info({ to: opts.to }, "Welcome email sent");
  } catch (err) {
    log.error({ err, to: opts.to }, "Exception sending welcome email");
  }
}

// ── sendConflictNotificationEmail ──────────────────────────────────────────────

export async function sendConflictNotificationEmail(opts: {
  to: string;
  recipientName: string;
  file: string;
  workspaceName: string;
  workspaceId: string;
  detectedBy: string;
}): Promise<void> {
  if (!isResendConfigured()) {
    log.warn({ to: opts.to }, "Resend not configured — skipping conflict email");
    return;
  }
  const conflictsUrl = `${env.CLIENT_URL}/workspace/${opts.workspaceId}/conflicts`;
  const html = baseTemplate(
    `<h1>Conflict detected in <em>${opts.workspaceName}</em></h1>
     <p class="highlight">Stackfox AI detected a potential conflict while <strong>${opts.detectedBy}</strong> pushed changes.</p>
     <div style="background:rgba(255,100,100,0.08);border:1px solid rgba(255,100,100,0.2);border-radius:8px;padding:16px 20px;margin:16px 0;">
       <div style="font-size:12px;color:#888;margin-bottom:4px;">Affected file</div>
       <div class="code-box" style="margin:0;">${opts.file}</div>
     </div>
     <a href="${conflictsUrl}" class="cta-btn">View and Resolve Conflict</a>
     <hr class="divider" />
     <p>Stackfox AI will suggest the best resolution. You can accept, modify, or dismiss it from the Conflicts panel.</p>`,
    `Conflict detected in ${opts.file}`,
  );
  try {
    const { error } = await getClient().emails.send({
      from: FROM,
      to: opts.to,
      subject: `Conflict detected in ${opts.workspaceName} — ${opts.file}`,
      html,
    });
    if (error) log.error({ error, to: opts.to }, "Failed to send conflict email");
    else log.info({ to: opts.to, file: opts.file }, "Conflict notification email sent");
  } catch (err) {
    log.error({ err, to: opts.to }, "Exception sending conflict email");
  }
}

// ── sendMemberJoinedEmail ──────────────────────────────────────────────────────

export async function sendMemberJoinedEmail(opts: {
  to: string[];
  joinerName: string;
  joinerEmail: string;
  workspaceName: string;
  workspaceId: string;
  role: string;
}): Promise<void> {
  if (!isResendConfigured() || opts.to.length === 0) return;
  const workspaceUrl = `${env.CLIENT_URL}/workspace/${opts.workspaceId}`;
  const html = baseTemplate(
    `<h1>${opts.joinerName} joined <em>${opts.workspaceName}</em></h1>
     <p class="highlight"><strong>${opts.joinerName}</strong> (${opts.joinerEmail}) has joined your workspace as a <span class="badge">${opts.role}</span>.</p>
     <p>Your team graph has been updated. You can now see their activity in the shared workspace.</p>
     <a href="${workspaceUrl}" class="cta-btn">Open Workspace</a>`,
    `${opts.joinerName} joined ${opts.workspaceName}`,
  );
  try {
    const { error } = await getClient().emails.send({
      from: FROM,
      to: opts.to,
      subject: `${opts.joinerName} joined ${opts.workspaceName} on Stackfox`,
      html,
    });
    if (error) log.error({ error }, "Failed to send member joined email");
    else log.info({ recipients: opts.to.length }, "Member joined email sent");
  } catch (err) {
    log.error({ err }, "Exception sending member joined email");
  }
}
