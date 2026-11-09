import { deleteOldMessages } from "./models/chats.js";
import { sendDueReminders } from "./notifications.js";

// Regular tasks: reminder emails for tomorrow's activities and deleting chat
// messages older than 12 months. Safe to run as often as wanted.
export async function runJobs() {
  const reminders = await sendDueReminders();
  const deletedMessages = await deleteOldMessages();
  return { reminders, deleted_messages: deletedMessages };
}
