import nodemailer from 'nodemailer';
import { prisma } from '../lib/prisma.js';
import crypto from 'crypto';
import { getVerifiedEmailAddresses, normalizeEmail, syncPrimaryEmail } from './userEmailUtils.js';

interface EmailConfig {
  host: string;
  port: number;
  secure: boolean;
  senderEmail: string;
  auth: {
    user: string;
    pass: string;
  };
}

class EmailService {
  private transporter: nodemailer.Transporter | null = null;
  private config: EmailConfig | null = null;

  constructor() {
    this.initializeTransporter();
  }

  private initializeTransporter() {
    // For development, we'll use a simple SMTP configuration
    // In production, you might want to use services like SendGrid, AWS SES, etc.
    const emailConfig = {
      host: process.env.SMTP_HOST || 'localhost',
      port: parseInt(process.env.SMTP_PORT || '25'),
      secure: process.env.SMTP_SECURE === 'true',
      senderEmail: process.env.SMTP_SENDER_EMAIL || process.env.SMTP_USER || 'no-reply@localhost',
      auth: {
        user: process.env.SMTP_USER || '',
        pass: process.env.SMTP_PASS || ''
      }
    };

    // In development mode, always create a transporter (even without credentials)
    // In production mode, only create transporter if we have valid credentials
    if (process.env.NODE_ENV === 'development') {
      // For development, disable TLS/STARTTLS to avoid certificate issues
      const devConfig = {
        ...emailConfig,
        secure: false,
        tls: {
          rejectUnauthorized: false
        },
        ignoreTLS: true
      };

      this.transporter = nodemailer.createTransport(devConfig);
      this.config = devConfig;
    } else if (emailConfig.auth.user && emailConfig.auth.pass) {
      // For production, add proper TLS configuration and auth method
      const prodConfig = {
        ...emailConfig,
        tls: {
          rejectUnauthorized: true
        },
        authMethod: 'PLAIN'
      };

      this.transporter = nodemailer.createTransport(prodConfig);
      this.config = prodConfig;
      console.log('Email service initialized with production SMTP configuration');
    } else {
      console.warn('Email service not configured - SMTP credentials missing');
    }
  }

  async sendEvaluationStatusChangeEmail(
    userId: number,
    recipientName: string | null | undefined,
    previousStatus: string,
    nextStatus: string
  ): Promise<boolean> {
    if (!this.transporter) {
      console.error('Email service not configured - cannot send evaluation status change email');
      return false;
    }

    try {
      const recipientEmails = await getVerifiedEmailAddresses(prisma, userId);
      if (recipientEmails.length === 0) {
        console.log(`No verified email addresses found for user ${userId}; skipping evaluation status notification`);
        return false;
      }

      const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
      const senderEmail = process.env.SMTP_SENDER_EMAIL || this.config?.auth.user || `no-reply@${new URL(frontendUrl).hostname}`;
      const subject = `Your Meritocracy evaluation status changed to ${this.formatEvaluationStatusLabel(nextStatus)}`;
      const safeRecipientName = this.escapeHtml(recipientName || 'there');
      const previousLabel = this.formatEvaluationStatusLabel(previousStatus);
      const nextLabel = this.formatEvaluationStatusLabel(nextStatus);
      const text = `
Dear ${recipientName || 'there'},

Your Meritocracy evaluation status changed from ${previousLabel} to ${nextLabel}.

If you think this is wrong, you can revisit your connected accounts and try again when re-evaluation is available.

— Meritocracy Platform
      `.trim();
      const html = `
        <div style="font-family: Arial, sans-serif; max-width: 640px; margin: 0 auto; color: #111;">
          <h2 style="color: #1f2937;">Meritocracy evaluation update</h2>
          <p>Dear ${safeRecipientName},</p>
          <p>Your Meritocracy evaluation status changed from <strong>${this.escapeHtml(previousLabel)}</strong> to <strong>${this.escapeHtml(nextLabel)}</strong>.</p>
          <p>If you think this is wrong, review your connected accounts and try again when re-evaluation is available.</p>
          <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;">
          <p style="font-size: 12px; color: #6b7280;">Meritocracy Platform</p>
        </div>
      `;

      let sentAny = false;
      for (const recipientEmail of recipientEmails) {
        try {
          await this.transporter.sendMail({
            from: `"Meritocracy Platform" <${senderEmail}>`,
            to: recipientEmail,
            subject,
            html,
            text
          });
          sentAny = true;
        } catch (error) {
          console.error(`Failed to send evaluation status email to user ${userId} at ${recipientEmail}`, error);
        }
      }

      return sentAny;
    } catch (error) {
      console.error('Failed to send evaluation status change email:', error);
      return false;
    }
  }

  async sendVerificationEmail(email: string, verificationToken: string, userId: number): Promise<boolean> {
    if (!this.transporter) {
      console.error('Email service not configured - cannot send verification email');
      return false;
    }

    try {
      const normalizedEmail = normalizeEmail(email);
      const verificationUrl = `${process.env.FRONTEND_URL}/verify-email?token=${verificationToken}`;

      const senderEmail = this.config?.senderEmail ?? this.config?.auth.user ?? 'no-reply@localhost';

      const mailOptions = {
        from: `"Meritocracy Platform" <${senderEmail}>`,
        to: normalizedEmail,
        subject: 'Verify Your Email Address - Meritocracy Platform',
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #333;">Welcome to Meritocracy Platform!</h2>
            <p>Thank you for connecting your email address. To complete the verification process, please click the button below:</p>
            
            <div style="text-align: center; margin: 30px 0;">
              <a href="${verificationUrl}" 
                 style="background-color: #4f46e5; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">
                Verify Email Address
              </a>
            </div>
            
            <p>If the button doesn't work, you can copy and paste this link into your browser:</p>
            <p style="word-break: break-all; color: #666;">${verificationUrl}</p>
            
            <p style="color: #666; font-size: 14px;">
              This verification link will expire in 24 hours. If you didn't request this verification, you can safely ignore this email.
            </p>
            
            <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">
            <p style="color: #999; font-size: 12px;">
              This email was sent from Meritocracy Platform. If you have any questions, please contact our support team.
            </p>
          </div>
        `,
        text: `
          Welcome to Meritocracy Platform!
          
          Thank you for connecting your email address. To complete the verification process, please visit the following link:
          
          ${verificationUrl}
          
          This verification link will expire in 24 hours. If you didn't request this verification, you can safely ignore this email.
          
          Best regards,
          Meritocracy Platform Team
        `
      };

      const info = await this.transporter.sendMail(mailOptions);
      console.log('Verification email sent successfully:', info.messageId);

      // Store the verification token in the database
      await this.storeVerificationToken(verificationToken, normalizedEmail, userId);

      return true;
    } catch (error) {
      console.error('Failed to send verification email:', error);
      return false;
    }
  }

  private async storeVerificationToken(token: string, email: string, userId: number): Promise<void> {
    try {
      const expiresAt = new Date();
      expiresAt.setHours(expiresAt.getHours() + 24); // 24 hours from now

      await prisma.emailVerificationToken.create({
        data: {
          token: this.hashVerificationToken(token),
          email,
          userId,
          expiresAt
        }
      });
    } catch (error) {
      console.error('Failed to store verification token:', error);
      throw error;
    }
  }

  async verifyEmailToken(token: string): Promise<{ success: boolean; userId?: number; error?: string }> {
    try {
      const verificationToken = await prisma.emailVerificationToken.findUnique({
        where: { token: this.hashVerificationToken(token) },
        include: { user: true }
      });

      if (!verificationToken) {
        return { success: false, error: 'Invalid verification token' };
      }

      if (verificationToken.used) {
        return { success: false, error: 'Verification token has already been used' };
      }

      if (verificationToken.expiresAt < new Date()) {
        return { success: false, error: 'Verification token has expired' };
      }

      const consumed = await prisma.$transaction(async (tx) => {
        const updateResult = await tx.emailVerificationToken.updateMany({
          where: {
            id: verificationToken.id,
            used: false,
            expiresAt: { gt: new Date() }
          },
          data: { used: true }
        });
        if (updateResult.count !== 1) {
          return false;
        }

        await tx.userEmail.upsert({
          where: { email: verificationToken.email },
          update: {
            verified: true,
            userId: verificationToken.userId
          },
          create: {
            email: verificationToken.email,
            verified: true,
            userId: verificationToken.userId
          }
        });

        await syncPrimaryEmail(tx, verificationToken.userId);
        return true;
      });

      if (!consumed) {
        return { success: false, error: 'Verification token has already been used or expired' };
      }

      return { success: true, userId: verificationToken.userId };
    } catch (error) {
      console.error('Failed to verify email token:', error);
      return { success: false, error: 'Failed to verify email token' };
    }
  }

  generateVerificationToken(): string {
    return crypto.randomBytes(32).toString('hex');
  }

  private hashVerificationToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  async cleanupExpiredTokens(): Promise<void> {
    try {
      const result = await prisma.emailVerificationToken.deleteMany({
        where: {
          OR: [
            { expiresAt: { lt: new Date() } },
            { used: true }
          ]
        }
      });
      console.log(`Cleaned up ${result.count} expired/used verification tokens`);
    } catch (error) {
      console.error('Failed to cleanup expired tokens:', error);
    }
  }

  async sendOFACReport(userData: any, kycData: any, amlData: any, rejectionReason: string): Promise<boolean> {
    if (!this.transporter) {
      console.error('Email service not configured - cannot send OFAC report');
      return false;
    }

    try {
      const senderEmail = process.env.SMTP_SENDER_EMAIL || this.config!.auth.user;
      const currentDate = new Date().toISOString().split('T')[0];

      // Extract user information for the report
      const fullName = userData.name || 'Unknown';
      const email = userData.email || 'Not provided';
      const ethereumAddress = userData.ethereumAddress || 'Not provided';
      const issuingState = kycData?.issuingState || 'Not provided';
      const personalNumber = kycData?.personalNumber || 'Not provided';
      const documentType = kycData?.documentType || 'Not provided';
      const nationality = kycData?.nationality || 'Not provided';
      const dateOfBirth = kycData?.dateOfBirth || 'Not provided';

      // Determine reason for match
      let matchReason = 'KYC verification failed';
      if (amlData?.status === 'Rejected') {
        matchReason = 'AML screening detected potential sanctions match';
      } else if (rejectionReason) {
        matchReason = rejectionReason;
      }

      const mailOptions = {
        from: `"Victor Porton's Foundation" <${senderEmail}>`,
        to: 'ofacreport@treasury.gov',
        subject: 'Failed KYC report',
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto;">
            <h2 style="color: #333;">Failed KYC Report</h2>
            
            <div style="background-color: #f5f5f5; padding: 20px; border-radius: 5px; margin: 20px 0;">
              <h3 style="margin-top: 0;">Reporter Information</h3>
              <p><strong>Reporter:</strong> Victor Porton's Foundation</p>
              <p><strong>Compliance Officer:</strong> Viktor Porton &lt;porton.victor@gmail.com&gt;</p>
            </div>
            
            <div style="background-color: #fff3cd; padding: 20px; border-radius: 5px; margin: 20px 0; border-left: 4px solid #ffc107;">
              <h3 style="margin-top: 0;">Sanctioned Person/Entity Information</h3>
              <p><strong>Full Name:</strong> ${fullName}</p>
              <p><strong>Email Address:</strong> ${email}</p>
              <p><strong>Ethereum Address:</strong> ${ethereumAddress}</p>
              <p><strong>Document Type:</strong> ${documentType}</p>
              <p><strong>Issuing State:</strong> ${issuingState}</p>
              <p><strong>Personal/Document Number:</strong> ${personalNumber}</p>
              <p><strong>Nationality:</strong> ${nationality}</p>
              <p><strong>Date of Birth:</strong> ${dateOfBirth}</p>
            </div>
            
            <div style="background-color: #f8d7da; padding: 20px; border-radius: 5px; margin: 20px 0; border-left: 4px solid #dc3545;">
              <h3 style="margin-top: 0;">Reason for Match</h3>
              <p>${matchReason}</p>
            </div>
            
            <div style="background-color: #d1ecf1; padding: 20px; border-radius: 5px; margin: 20px 0; border-left: 4px solid #17a2b8;">
              <h3 style="margin-top: 0;">Transaction Details</h3>
              <p><strong>Date:</strong> ${currentDate}</p>
              <p><strong>Type of Transaction:</strong> KYC registration for independent contractor salary</p>
              <p><strong>Status:</strong> The transaction was rejected.</p>
            </div>
            
            <div style="background-color: #e2e3e5; padding: 20px; border-radius: 5px; margin: 20px 0;">
              <h3 style="margin-top: 0;">Relevant Documents/IDs Submitted</h3>
              <p>Identity verification documents were submitted through the KYC process but failed verification due to potential sanctions screening match.</p>
            </div>
            
            <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">
            <p style="color: #999; font-size: 12px;">
              This report was automatically generated by Victor Porton's Foundation compliance system.
            </p>
          </div>
        `,
        text: `
Failed KYC Report

Reporter Information:
Reporter: Victor Porton's Foundation
Compliance Officer: Viktor Porton <porton.victor@gmail.com>

Sanctioned Person/Entity Information:
Full Name: ${fullName}
Email Address: ${email}
Ethereum Address: ${ethereumAddress}
Document Type: ${documentType}
Issuing State: ${issuingState}
Personal/Document Number: ${personalNumber}
Nationality: ${nationality}
Date of Birth: ${dateOfBirth}

Reason for Match:
${matchReason}

Transaction Details:
Date: ${currentDate}
Type of Transaction: KYC registration for independent contractor salary
Status: The transaction was rejected.

Relevant Documents/IDs Submitted:
Identity verification documents were submitted through the KYC process but failed verification due to potential sanctions screening match.

---
This report was automatically generated by Victor Porton's Foundation compliance system.
        `
      };

      const info = await this.transporter.sendMail(mailOptions);
      console.log('OFAC report sent successfully:', info.messageId);

      return true;
    } catch (error) {
      console.error('Failed to send OFAC report:', error);
      return false;
    }
  }

  async sendKycRequestEmail(email: string, token: string, name?: string): Promise<boolean> {
    if (!this.transporter) {
      console.error('Email service not configured - cannot send KYC request email');
      return false;
    }

    try {
      const kycUrl = `${process.env.FRONTEND_URL}/connect?kycToken=${token}`;
      const senderEmail = process.env.SMTP_SENDER_EMAIL || this.config!.auth.user;

      const mailOptions = {
        from: `"Meritocracy Platform" <${senderEmail}>`,
        to: email,
        subject: 'KYC Verification Required - Meritocracy Platform',
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #333;">Action Required: Complete Your KYC</h2>
            <p>Hello ${name || 'there'},</p>
            <p>We are happy to inform you that funds have been allocated for you on the Meritocracy Platform!</p>
            <p>To receive your payment, we require you to complete a quick KYC (Know Your Customer) verification process for compliance reasons.</p>
            
            <div style="text-align: center; margin: 30px 0;">
              <a href="${kycUrl}" 
                 style="background-color: #4f46e5; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">
                Complete KYC Verification
              </a>
            </div>
            
            <p>Once your KYC is approved, your allocated funds will be released to your connected wallet in the next distribution cycle.</p>
            
            <p>If the button doesn't work, you can copy and paste this link into your browser:</p>
            <p style="word-break: break-all; color: #666;">${kycUrl}</p>
            
            <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">
            <p style="color: #999; font-size: 12px;">
              This email was sent from Meritocracy Platform. If you have any questions, please contact our support team.
            </p>
          </div>
        `,
        text: `
          Hello ${name || 'there'},

          We are happy to inform you that funds have been allocated for you on the Meritocracy Platform!

          To receive your payment, we require you to complete a quick KYC (Know Your Customer) verification process for compliance reasons.

          Please visit the following link to complete your KYC:
          ${kycUrl}

          Once your KYC is approved, your allocated funds will be released to your connected wallet in the next distribution cycle.

          Best regards,
          Meritocracy Platform Team
        `
      };

      const info = await this.transporter.sendMail(mailOptions);
      console.log('KYC request email sent successfully:', info.messageId);
      return true;
    } catch (error) {
      console.error('Failed to send KYC request email:', error);
      return false;
    }
  }

  async sendLivelinessRequestEmail(email: string, token: string, name?: string): Promise<boolean> {
    if (!this.transporter) {
      console.error('Email service not configured - cannot send Liveliness request email');
      return false;
    }

    try {
      const livelinessUrl = `${process.env.FRONTEND_URL}/connect?livelinessToken=${token}`;
      const senderEmail = process.env.SMTP_SENDER_EMAIL || this.config!.auth.user;
      const mailOptions = {
        from: `"Meritocracy Platform" <${senderEmail}>`,
        to: email,
        subject: 'Action required: renew your Didit Liveliness check',
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #333;">Renew your payout eligibility check</h2>
            <p>Hello ${name || 'there'},</p>
            <p>Before your next payout, please complete a short Didit Liveliness check. This periodically confirms that the recipient is present; it does not require you to have produced new work recently.</p>
            <div style="text-align: center; margin: 30px 0;">
              <a href="${livelinessUrl}" style="background-color: #4f46e5; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">Complete Liveliness check</a>
            </div>
            <p>If the button does not work, copy this link into your browser:</p>
            <p style="word-break: break-all; color: #666;">${livelinessUrl}</p>
          </div>
        `,
        text: `Hello ${name || 'there'},\n\nBefore your next payout, please complete a short Didit Liveliness check. This periodically confirms that the recipient is present; it does not require new work.\n\nComplete it here: ${livelinessUrl}`
      };
      const info = await this.transporter.sendMail(mailOptions);
      console.log('Liveliness request email sent successfully:', info.messageId);
      return true;
    } catch (error) {
      console.error('Failed to send Liveliness request email:', error);
      return false;
    }
  }

  async sendVotingPleaEmail(targetName: string, voteType: 'BAN' | 'UNBAN'): Promise<void> {
    if (!this.transporter) {
      console.warn('Email service not configured - skipping voting plea emails');
      return;
    }

    try {
      const recipients = await prisma.user.findMany({
        where: {
          votingPleaUnsubscribed: false,
          OR: [
            {
              emails: {
                some: {
                  verified: true
                }
              }
            },
            {
              emailVerified: true,
              email: {
                not: null
              }
            }
          ]
        },
        select: {
          id: true,
          name: true,
          emails: {
            where: {
              verified: true
            },
            select: {
              email: true
            }
          }
        }
      });

      if (recipients.length === 0) {
        console.log('Voting plea: no verified recipients found');
        return;
      }

      const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
      const preferenceUrl = `${frontendUrl}/connect`;
      const actionLabel = voteType === 'BAN' ? 'Ban' : 'Unban';
      const actionDescription = voteType === 'BAN'
        ? `ban the user ${targetName}`
        : `reverse the ban on ${targetName}`;

      const senderEmail = process.env.SMTP_SENDER_EMAIL || this.config?.auth.user || `no-reply@${new URL(frontendUrl).hostname}`;

      for (const recipient of recipients) {
        const recipientEmails = await getVerifiedEmailAddresses(prisma, recipient.id);
        if (recipientEmails.length === 0) continue;

        const recipientName = recipient.name || 'Meritocracy voter';
        const subject = `Voting plea: ${actionLabel} vote for ${targetName}`;
        const html = `
          <div style="font-family: Arial, sans-serif; max-width: 640px; margin: 0 auto; color: #111;">
            <h2 style="color: #1f2937;">Voting plea: ${actionLabel} ${targetName}</h2>
            <p>Dear ${recipientName},</p>
            <p>Someone has proposed to ${voteType === 'BAN' ? 'ban' : 'unban'} ${targetName}. Please cast your vote so the community can ${actionDescription}.</p>
            <p style="color: #b91c1c; font-weight: 600;">If you don't vote, scammers can take all your money.</p>
            <p>This is the only warning you will receive for this case. You can unsubscribe from this type of email on the <a href="${preferenceUrl}">Connect</a> page.</p>
            <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;">
            <p style="font-size: 12px; color: #6b7280;">Meritocracy Platform</p>
          </div>
        `;
        const text = `
Dear ${recipientName},

Someone has proposed to ${voteType === 'BAN' ? 'ban' : 'unban'} ${targetName}. Please cast your vote so the community can ${actionDescription}.

If you don't vote, scammers can take all your money.

You can stop receiving these emails from your account preferences on the Connect page: ${preferenceUrl}

— Meritocracy Platform
        `;

        try {
          for (const recipientEmail of recipientEmails) {
            await this.transporter.sendMail({
              from: `"Meritocracy Platform" <${senderEmail}>`,
              to: recipientEmail,
              subject,
              html,
              text
            });
          }
        } catch (error) {
          console.error('Failed to send voting plea email to user', recipient.id, error);
        }
      }
    } catch (error) {
      console.error('Failed to broadcast voting plea emails:', error);
    }
  }

  async storeKycToken(token: string, userId: number): Promise<void> {
    try {
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 30); // 30 days from now

      await (prisma as any).kycToken.create({
        data: {
          token: this.hashKycToken(token),
          userId,
          expiresAt
        }
      });
    } catch (error) {
      console.error('Failed to store KYC token:', error);
      throw error;
    }
  }

  async consumeKycToken(token: string, expectedUserId?: number): Promise<{ success: boolean; userId?: number; error?: string }> {
    try {
      const kycToken = await (prisma as any).kycToken.findUnique({
        where: { token: this.hashKycToken(token) },
      });

      if (!kycToken) {
        return { success: false, error: 'Invalid KYC token' };
      }

      if (expectedUserId !== undefined && kycToken.userId !== expectedUserId) {
        return { success: false, error: 'KYC token does not belong to this user' };
      }

      if (kycToken.used) {
        return { success: false, error: 'KYC token has already been used' };
      }

      if (kycToken.expiresAt < new Date()) {
        return { success: false, error: 'KYC token has expired' };
      }

      const consumed = await (prisma as any).kycToken.updateMany({
        where: {
          id: kycToken.id,
          used: false,
          expiresAt: { gt: new Date() }
        },
        data: { used: true }
      });
      if (consumed.count !== 1) {
        return { success: false, error: 'KYC token has already been used or expired' };
      }

      return { success: true, userId: kycToken.userId };
    } catch (error) {
      console.error('Failed to consume KYC token:', error);
      return { success: false, error: 'Failed to verify KYC token' };
    }
  }

  generateKycToken(): string {
    return crypto.randomBytes(32).toString('hex');
  }

  private hashKycToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  private formatEvaluationStatusLabel(status: string): string {
    if (status === 'ACTIVE_RESEARCHER') {
      return 'active researcher';
    }

    if (status === 'CRACKPOT') {
      return 'crackpot';
    }

    if (status === 'NOT_ACTIVE_OR_WRITER') {
      return 'not active researcher or writer';
    }

    return status.toLowerCase().replace(/_/g, ' ');
  }

  private escapeHtml(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
}

export default new EmailService();
