import nodemailer from 'nodemailer';
import { PrismaClient } from '@prisma/client';
import crypto from 'crypto';

const prisma = new PrismaClient();

interface EmailConfig {
  host: string;
  port: number;
  secure: boolean;
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

  async sendVerificationEmail(email: string, verificationToken: string, userId: number): Promise<boolean> {
    if (!this.transporter) {
      console.error('Email service not configured - cannot send verification email');
      return false;
    }

    try {
      const verificationUrl = `${process.env.FRONTEND_URL}/verify-email?token=${verificationToken}`;
      
      // Use a proper sender address - in development mode, use a default one
      // If the user doesn't contain a domain (no @ symbol), use localhost domain
      const senderEmail = process.env.SMTP_SENDER_EMAIL || this.config!.auth.user; // TODO@P3: Move to `this.config`.
      
      const mailOptions = {
        from: `"Socialism Platform" <${senderEmail}>`,
        to: email,
        subject: 'Verify Your Email Address - Socialism Platform',
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #333;">Welcome to Socialism Platform!</h2>
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
              This email was sent from Socialism Platform. If you have any questions, please contact our support team.
            </p>
          </div>
        `,
        text: `
          Welcome to Socialism Platform!
          
          Thank you for connecting your email address. To complete the verification process, please visit the following link:
          
          ${verificationUrl}
          
          This verification link will expire in 24 hours. If you didn't request this verification, you can safely ignore this email.
          
          Best regards,
          Socialism Platform Team
        `
      };

      const info = await this.transporter.sendMail(mailOptions);
      console.log('Verification email sent successfully:', info.messageId);
      
      // In development mode, also log the verification details for easy testing
      if (process.env.NODE_ENV === 'development') {
        console.log(`Verification URL: ${verificationUrl}`);
      }
      
      // Store the verification token in the database
      await this.storeVerificationToken(verificationToken, email, userId);
      
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
          token,
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
        where: { token },
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

      // Mark token as used and update user's email verification status
      await prisma.$transaction([
        prisma.emailVerificationToken.update({
          where: { id: verificationToken.id },
          data: { used: true }
        }),
        prisma.user.update({
          where: { id: verificationToken.userId },
          data: { emailVerified: true }
        })
      ]);

      return { success: true, userId: verificationToken.userId };
    } catch (error) {
      console.error('Failed to verify email token:', error);
      return { success: false, error: 'Failed to verify email token' };
    }
  }

  generateVerificationToken(): string {
    return crypto.randomBytes(32).toString('hex');
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
}

export default new EmailService();
