import { apiFetch } from './api';

// Recruiter-only transactional email (stage automations). Sends the recruiter's
// auth token; the server rejects it otherwise.
export async function sendEmail(to: string, subject: string, html: string) {
  try {
    const res = await apiFetch('/api/email/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to, subject, html })
    });
    return await res.json();
  } catch (error) {
    console.error("Error sending email:", error);
    return { success: false, error };
  }
}

// Public: the candidate's "application received" confirmation. The server owns the
// template — we only pass data, never HTML — so this is not an open relay.
export async function sendApplicationConfirmation(email: string, name: string, vacancyTitle: string) {
  try {
    const res = await fetch('/api/public/apply-confirmation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, name, vacancyTitle })
    });
    return await res.json();
  } catch (error) {
    console.error("Error sending confirmation email:", error);
    return { success: false, error };
  }
}

export function getEmailTemplate(title: string, content: string, logoUrl: string = '') {
  return `
    <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);">
      <div style="background-color: #ffffff; padding: 24px; text-align: center; border-bottom: 2px solid #f1f5f9;">
        ${logoUrl ? `<img src="${logoUrl}" alt="Darwin Cell" style="max-height: 80px; object-fit: contain;" />` : `<h1 style="color: #0f172a; margin: 0; font-size: 24px;">Darwin Cell</h1>`}
      </div>
      <div style="padding: 32px; background-color: #ffffff; color: #334155; line-height: 1.6; font-size: 16px;">
        <h2 style="color: #0f172a; margin-top: 0; font-size: 20px;">${title}</h2>
        <div style="margin-top: 20px;">
          ${content.replace(/\n/g, '<br/>')}
        </div>
      </div>
      <div style="background-color: #f8fafc; padding: 20px; text-align: center; font-size: 13px; color: #64748b; border-top: 1px solid #e2e8f0;">
        © ${new Date().getFullYear()} Darwin Cell. Todos los derechos reservados.<br/>
        Este es un correo automático, por favor no respondas a esta dirección.
      </div>
    </div>
  `;
}
