export interface AccountRecoveryEmailSender {
  sendAccountRecoveryCode(email: string, code: string): Promise<void>;
}

export interface ResendEmailConfig {
  apiKey: string;
  from: string;
}

/** Minimal Resend REST adapter; secrets and provider response bodies are never logged. */
export class ResendAccountRecoveryEmailSender implements AccountRecoveryEmailSender {
  constructor(private readonly config: ResendEmailConfig, private readonly fetcher: typeof fetch = fetch) {}

  async sendAccountRecoveryCode(email: string, code: string): Promise<void> {
    const response = await this.fetcher("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${this.config.apiKey}`, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(10_000),
      body: JSON.stringify({
        from: this.config.from,
        to: [email],
        subject: "Código para recuperar tu cuenta PetCare",
        text: `Tu código de verificación de PetCare es ${code}. Caduca en 10 minutos. Si no solicitaste este código, puedes ignorar este mensaje.`,
      }),
    });
    if (!response.ok) throw new Error("Account recovery email provider rejected the request.");
  }
}
