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

    console.log('EmailService initialization - SMTP config:', {
      host: emailConfig.host,
      port: emailConfig.port,
      secure: emailConfig.secure,
      hasUser: !!emailConfig.auth.user,
      hasPass: !!emailConfig.auth.pass,
      user: emailConfig.auth.user || 'empty',
      passLength: emailConfig.auth.pass ? emailConfig.auth.pass.length : 0,
      passPreview: emailConfig.auth.pass ? emailConfig.auth.pass.substring(0, 4) + '...' : 'empty'
    });

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
      console.log('Email service initialized for development mode with config:', {
        host: devConfig.host,
        port: devConfig.port,
        secure: devConfig.secure,
        hasAuth: !!(devConfig.auth.user && devConfig.auth.pass),
        ignoreTLS: devConfig.ignoreTLS
      });
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
    console.log('EmailService.sendVerificationEmail called with:', { email, userId, token: verificationToken });
    console.log('Transporter exists:', !!this.transporter);
    console.log('NODE_ENV:', process.env.NODE_ENV);
    console.log('Current SMTP config:', {
      host: this.config?.host,
      port: this.config?.port,
      secure: this.config?.secure,
      hasUser: !!this.config?.auth?.user,
      hasPass: !!this.config?.auth?.pass,
      user: this.config?.auth?.user || 'empty'
    });
    
    if (!this.transporter) {
      console.error('Email service not configured - cannot send verification email');
      return false;
    }

    console.log('Using transporter to send email');

    try {
      const verificationUrl = `${process.env.FRONTEND_URL}/verify-email?token=${verificationToken}`;
      
      // Use a proper sender address - in development mode, use a default one
      // If the user doesn't contain a domain (no @ symbol), use localhost domain
      const senderEmail = process.env.SMTP_SENDER_EMAIL || this.config!.auth.user; // TODO@P3: Move to `this.config`.
      console.log('Sender email being used:', senderEmail);
      console.log('Config auth user:', this.config!.auth.user);
      
      console.log('Recipient email:', email);
      
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
        console.log('=== DEVELOPMENT MODE: EMAIL VERIFICATION DETAILS ===');
        console.log(`Email: ${email}`);
        console.log(`Verification Token: ${verificationToken}`);
        console.log(`Verification URL: ${verificationUrl}`);
        console.log('===================================================');
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
}

export default new EmailService();
