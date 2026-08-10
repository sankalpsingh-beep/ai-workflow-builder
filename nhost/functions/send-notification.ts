import { Request, Response } from 'express';

/**
 * Send Notification Handler (Hasura Event Trigger)
 * 
 * This function is called by a Hasura Event Trigger when a row is inserted
 * into workflow_logs with log_type = 'notification'.
 * 
 * It handles sending actual Slack/email notifications.
 * For demo purposes, we use stubbed implementations with simulated delays.
 * In production, integrate with real Slack webhook or email service.
 */

interface HasuraEventPayload {
  event: {
    session_variables: Record<string, string>;
    op: 'INSERT' | 'UPDATE' | 'DELETE';
    data: {
      old: Record<string, any> | null;
      new: Record<string, any> | null;
    };
  };
  created_at: string;
  id: string;
  trigger: {
    name: string;
  };
  table: {
    schema: string;
    name: string;
  };
}

interface NotificationData {
  channel: 'slack' | 'email';
  recipient: string;
  message: string;
  sent_at: string;
}

// Slack notification (stubbed - replace with real webhook in production)
async function sendSlackNotification(recipient: string, message: string): Promise<boolean> {
  const webhookUrl = process.env.SLACK_WEBHOOK_URL;
  
  if (webhookUrl) {
    // Real Slack webhook integration
    try {
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channel: recipient,
          text: message,
          username: 'Workflow Bot',
          icon_emoji: ':robot_face:'
        })
      });
      return response.ok;
    } catch (error) {
      console.error('Slack webhook error:', error);
      return false;
    }
  }
  
  // Stubbed implementation with simulated delay
  console.log(`[SLACK NOTIFICATION] To: ${recipient}`);
  console.log(`[SLACK NOTIFICATION] Message: ${message}`);
  await new Promise(resolve => setTimeout(resolve, 500)); // 500ms delay
  return true;
}

// Email notification (stubbed - integrate with SendGrid, SES, etc. in production)
async function sendEmailNotification(recipient: string, message: string): Promise<boolean> {
  const emailApiKey = process.env.SENDGRID_API_KEY || process.env.EMAIL_API_KEY;
  
  if (emailApiKey) {
    // Real email integration (SendGrid example)
    try {
      const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${emailApiKey}`
        },
        body: JSON.stringify({
          personalizations: [{ to: [{ email: recipient }] }],
          from: { email: process.env.EMAIL_FROM || 'noreply@workflow.app' },
          subject: 'Workflow Notification',
          content: [{ type: 'text/plain', value: message }]
        })
      });
      return response.ok;
    } catch (error) {
      console.error('Email API error:', error);
      return false;
    }
  }
  
  // Stubbed implementation with simulated delay
  console.log(`[EMAIL NOTIFICATION] To: ${recipient}`);
  console.log(`[EMAIL NOTIFICATION] Message: ${message}`);
  await new Promise(resolve => setTimeout(resolve, 500)); // 500ms delay
  return true;
}

export default async function handler(req: Request, res: Response) {
  const payload: HasuraEventPayload = req.body;
  
  // Only process INSERT events
  if (payload.event.op !== 'INSERT') {
    return res.json({ success: true, message: 'Ignored: not an INSERT event' });
  }
  
  const newRow = payload.event.data.new;
  
  if (!newRow) {
    return res.json({ success: true, message: 'Ignored: no new data' });
  }
  
  // Only process notification log types
  if (newRow.log_type !== 'notification') {
    return res.json({ success: true, message: 'Ignored: not a notification log' });
  }
  
  const data: NotificationData = newRow.data;
  
  if (!data || !data.channel || !data.recipient || !data.message) {
    return res.json({
      success: false,
      message: 'Invalid notification data: missing channel, recipient, or message'
    });
  }
  
  try {
    let sent = false;
    
    if (data.channel === 'slack') {
      sent = await sendSlackNotification(data.recipient, data.message);
    } else if (data.channel === 'email') {
      sent = await sendEmailNotification(data.recipient, data.message);
    } else {
      return res.json({
        success: false,
        message: `Unknown notification channel: ${data.channel}`
      });
    }
    
    console.log(`[NOTIFICATION] ${data.channel} to ${data.recipient}: ${sent ? 'SENT' : 'FAILED'}`);
    
    return res.json({
      success: sent,
      message: sent 
        ? `Notification sent via ${data.channel} to ${data.recipient}`
        : `Failed to send notification via ${data.channel}`,
      channel: data.channel,
      recipient: data.recipient
    });
    
  } catch (error: any) {
    console.error('Send notification error:', error);
    return res.status(500).json({
      success: false,
      message: error.message
    });
  }
}
