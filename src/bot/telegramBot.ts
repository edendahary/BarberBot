import { Bot, InlineKeyboard, Context } from "grammy";
import User from "../models/User";
import Appointment from "../models/Appointment";
import DayOff from "../models/DayOff";
import bcrypt from "bcryptjs";
import dayjs from "dayjs";

const botToken = process.env.TELEGRAM_BOT_TOKEN;

if (!botToken) {
  throw new Error("TELEGRAM_BOT_TOKEN is required");
}

// Create bot instance
const bot = new Bot(botToken);

// Store user sessions (in production, use Redis or database)
const userSessions = new Map<number, { step?: string; tempData?: any }>();

// Helper function to get user session
function getSession(chatId: number) {
  if (!userSessions.has(chatId)) {
    userSessions.set(chatId, {});
  }
  return userSessions.get(chatId)!;
}

// Helper function to clear session
function clearSession(chatId: number) {
  userSessions.delete(chatId);
}

// Main menu keyboard
function getMainMenu(isBarber: boolean = false): InlineKeyboard {
  const keyboard = new InlineKeyboard()
    .text("📅 הזמן תור", "book_appointment")
    .row()
    .text("📋 התורים שלי", "my_appointments");

  if (isBarber) {
    keyboard
      .row()
      .text("👥 כל התורים", "all_appointments")
      .row()
      .text("🏖️ ניהול ימי חופש", "manage_days_off");
  }

  return keyboard;
}

// Date selection keyboard
async function getDateKeyboard(daysOff: string[] = []): Promise<InlineKeyboard> {
  const keyboard = new InlineKeyboard();
  const today = dayjs();

  for (let i = 0; i < 7; i++) {
    const date = today.add(i, "day");
    const dateStr = date.format("YYYY-MM-DD");
    const isSaturday = date.day() === 6;
    const isDayOff = daysOff.includes(dateStr);

    let label =
      i === 0 ? "היום" : i === 1 ? "מחר" : date.format("DD/MM (ddd)");

    if (isSaturday) {
      label = `🚫 ${label} (שבת)`;
      keyboard.text(label, "day_off_saturday").row();
    } else if (isDayOff) {
      label = `🏖️ ${label} (יום חופש)`;
      keyboard.text(label, "day_off_selected").row();
    } else {
      keyboard.text(label, `select_date_${dateStr}`).row();
    }
  }

  keyboard.text("🔙 חזור", "back_to_menu");

  return keyboard;
}

// Time slots keyboard
function getTimeSlotsKeyboard(
  date: string,
  bookedSlots: string[] = []
): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  const slots = Array.from({ length: 10 }, (_, i) => i + 9); // 9-18

  const now = dayjs();
  const isToday = date === now.format("YYYY-MM-DD");
  const currentHour = now.hour();

  let row: { text: string; data: string }[] = [];

  for (let i = 0; i < slots.length; i++) {
    const hour = slots[i];
    const timeStr = `${hour}:00`;
    const isBooked = bookedSlots.includes(timeStr);
    const isPast = isToday && hour <= currentHour;

    if (isPast) {
      continue;
    }

    row.push({
      text: isBooked ? `❌ ${timeStr}` : `✅ ${timeStr}`,
      data: isBooked ? "slot_unavailable" : `book_slot_${date}_${hour}`,
    });

    if (row.length === 3) {
      row.forEach((btn) => keyboard.text(btn.text, btn.data));
      keyboard.row();
      row = [];
    }
  }

  // Add remaining buttons
  if (row.length > 0) {
    row.forEach((btn) => keyboard.text(btn.text, btn.data));
    keyboard.row();
  }

  // If no available slots for today
  if (keyboard.inline_keyboard.length === 0) {
    keyboard.text("אין שעות פנויות להיום", "no_slots").row();
  }

  keyboard.text("🔙 חזור", "book_appointment");

  return keyboard;
}

// Start command - Registration/Login
bot.command("start", async (ctx) => {
  const chatId = ctx.chat.id;
  const telegramUserId = ctx.from?.id;

  try {
    const existingUser = await User.findOne({ telegramId: telegramUserId });

    if (existingUser) {
      const isBarber = existingUser.role === "barber";
      await ctx.reply(`👋 שלום ${existingUser.name}!\n\nמה תרצה לעשות?`, {
        reply_markup: getMainMenu(isBarber),
      });
    } else {
      await ctx.reply(`👋 ברוך הבא למערכת התורים!\n\nמה השם שלך?`);
      const session = getSession(chatId);
      session.step = "register_name";
      session.tempData = { telegramId: telegramUserId };
    }
  } catch (error) {
    console.error("Error in /start:", error);
    await ctx.reply("❌ אירעה שגיאה. אנא נסה שוב מאוחר יותר.");
  }
});

// Handle text messages (for registration flow)
bot.on("message:text", async (ctx) => {
  const chatId = ctx.chat.id;
  const text = ctx.message.text;

  // Ignore commands
  if (text?.startsWith("/")) return;

  const session = getSession(chatId);

  if (session.step === "register_name") {
    const userName = text;
    const telegramId = session.tempData.telegramId;

    try {
      const newUser = await User.create({
        name: userName,
        email: `telegram_${telegramId}@temp.com`,
        password: await bcrypt.hash(`telegram_${telegramId}`, 10),
        role: "user",
        telegramId: telegramId,
      });

      clearSession(chatId);

      await ctx.reply(
        `✅ רשום בהצלחה!\n\nשלום ${newUser.name}, מה תרצה לעשות?`,
        {
          reply_markup: getMainMenu(false),
        }
      );
    } catch (error) {
      console.error("Error creating user:", error);
      await ctx.reply("❌ אירעה שגיאה בהרשמה. נסה שוב מאוחר יותר.");
      clearSession(chatId);
    }
  }
});

// Handle callback queries (button presses)
bot.on("callback_query:data", async (ctx) => {
  const chatId = ctx.chat!.id;
  const data = ctx.callbackQuery.data;
  const userId = ctx.from.id;

  try {
    // Book appointment flow
    if (data === "book_appointment") {
      const daysOffDocs = await DayOff.find({});
      const daysOff = daysOffDocs.map((d) => d.date);

      await ctx.editMessageText("📅 בחר תאריך לתור:", {
        reply_markup: await getDateKeyboard(daysOff),
      });
    }

    // Date selected
    else if (data.startsWith("select_date_")) {
      const date = data.replace("select_date_", "");
      const session = getSession(chatId);
      session.tempData = { selectedDate: date };

      const dayStart = new Date(`${date}T00:00:00`);
      const dayEnd = new Date(`${date}T23:59:59`);

      const appointments = await Appointment.find({
        time: { $gte: dayStart, $lt: dayEnd },
      });

      const bookedSlots = appointments.map((apt) => {
        const hour = dayjs(apt.time).hour();
        return `${hour}:00`;
      });

      await ctx.editMessageText(
        `📅 תאריך: ${dayjs(date).format("DD/MM/YYYY")}\n\n⏰ בחר שעה:\n\n✅ = פנוי | ❌ = תפוס`,
        {
          reply_markup: getTimeSlotsKeyboard(date, bookedSlots),
        }
      );
    }

    // Time slot selected
    else if (data.startsWith("book_slot_")) {
      const [, , date, hourStr] = data.split("_");
      const hour = parseInt(hourStr);

      const user = await User.findOne({ telegramId: userId });

      if (!user) {
        await ctx.answerCallbackQuery({
          text: "❌ משתמש לא נמצא",
          show_alert: true,
        });
        return;
      }

      if (user.role !== "barber") {
        const dayStart = new Date(`${date}T00:00:00`);
        const dayEnd = new Date(`${date}T23:59:59`);

        const existingAppointment = await Appointment.findOne({
          user: user._id,
          time: { $gte: dayStart, $lt: dayEnd },
        });

        if (existingAppointment) {
          await ctx.answerCallbackQuery({
            text: "❌ כבר יש לך תור ביום הזה. ניתן להזמין תור אחד ליום בלבד.",
            show_alert: true,
          });
          return;
        }
      }

      const hourPadded = hour.toString().padStart(2, "0");
      const appointmentTime = new Date(`${date}T${hourPadded}:00:00`);

      await Appointment.create({
        user: user._id,
        barber: "barber",
        time: appointmentTime,
        status: "pending",
      });

      clearSession(chatId);

      await ctx.editMessageText(
        `✅ התור נקבע בהצלחה!\n\n📅 תאריך: ${dayjs(date).format("DD/MM/YYYY")}\n⏰ שעה: ${hour}:00\n\n✂️ הספר יאשר את התור בקרוב.`,
        {
          reply_markup: new InlineKeyboard().text(
            "🔙 תפריט ראשי",
            "back_to_menu"
          ),
        }
      );

      // Notify barber
      const barberChatId = process.env.TELEGRAM_BARBER_CHAT_ID;
      if (barberChatId) {
        await bot.api.sendMessage(
          barberChatId,
          `🔔 תור חדש!\n\n👤 לקוח: ${user.name}\n📅 תאריך: ${dayjs(date).format("DD/MM/YYYY")}\n⏰ שעה: ${hour}:00`
        );
      }
    }

    // My appointments
    else if (data === "my_appointments") {
      const user = await User.findOne({ telegramId: userId });

      if (!user) {
        await ctx.answerCallbackQuery({
          text: "❌ משתמש לא נמצא",
          show_alert: true,
        });
        return;
      }

      const appointments = await Appointment.find({
        user: user._id,
        time: { $gte: new Date() },
      }).sort({ time: 1 });

      if (appointments.length === 0) {
        await ctx.editMessageText("אין לך תורים קרובים.", {
          reply_markup: new InlineKeyboard().text(
            "🔙 תפריט ראשי",
            "back_to_menu"
          ),
        });
        return;
      }

      let message = "📋 התורים שלך:\n\n";
      const keyboard = new InlineKeyboard();

      appointments.forEach((apt, idx) => {
        const date = dayjs(apt.time);
        const status =
          apt.status === "approved"
            ? "✅ מאושר"
            : apt.status === "rejected"
            ? "❌ נדחה"
            : "⏳ ממתין לאישור";

        message += `${idx + 1}. ${date.format("DD/MM/YYYY")} בשעה ${date.format("HH:mm")}\n   סטטוס: ${status}\n\n`;

        keyboard.text(`🗑️ בטל תור ${idx + 1}`, `cancel_${apt._id}`).row();
      });

      keyboard.text("🔙 תפריט ראשי", "back_to_menu");

      await ctx.editMessageText(message, {
        reply_markup: keyboard,
      });
    }

    // All appointments (barber only)
    else if (data === "all_appointments") {
      const user = await User.findOne({ telegramId: userId });

      if (!user || user.role !== "barber") {
        await ctx.answerCallbackQuery({
          text: "❌ אין לך הרשאה",
          show_alert: true,
        });
        return;
      }

      const appointments = await Appointment.find({
        time: { $gte: new Date() },
      })
        .populate("user")
        .sort({ time: 1 });

      if (appointments.length === 0) {
        await ctx.editMessageText("אין תורים קרובים.", {
          reply_markup: new InlineKeyboard().text(
            "🔙 תפריט ראשי",
            "back_to_menu"
          ),
        });
        return;
      }

      let message = "👥 כל התורים:\n\n";
      const keyboard = new InlineKeyboard();

      appointments.forEach((apt, idx) => {
        const date = dayjs(apt.time);
        const status =
          apt.status === "approved"
            ? "✅"
            : apt.status === "rejected"
            ? "❌"
            : "⏳";

        message += `${idx + 1}. ${(apt.user as any).name}\n   ${date.format("DD/MM/YYYY HH:mm")} ${status}\n\n`;

        if (apt.status === "pending") {
          keyboard
            .text(`✅ אשר תור ${idx + 1}`, `approve_${apt._id}`)
            .text(`❌ דחה תור ${idx + 1}`, `reject_${apt._id}`)
            .row();
        } else {
          keyboard
            .text(`🗑️ בטל תור ${idx + 1}`, `barber_cancel_${apt._id}`)
            .row();
        }
      });

      keyboard.text("🔙 תפריט ראשי", "back_to_menu");

      await ctx.editMessageText(message, {
        reply_markup: keyboard,
      });
    }

    // Approve appointment
    else if (data.startsWith("approve_")) {
      const aptId = data.replace("approve_", "");

      const appointment = await Appointment.findById(aptId).populate("user");
      if (!appointment) return;

      await Appointment.findByIdAndUpdate(aptId, { status: "approved" });

      const customer = appointment.user as any;
      if (customer.telegramId) {
        const aptTime = dayjs(appointment.time);
        await bot.api.sendMessage(
          customer.telegramId,
          `✅ התור שלך אושר!\n\n📅 תאריך: ${aptTime.format("DD/MM/YYYY")}\n⏰ שעה: ${aptTime.format("HH:mm")}\n\nנתראה! 👋`
        );
      }

      await ctx.answerCallbackQuery({
        text: "✅ התור אושר!",
        show_alert: true,
      });

      // Refresh appointments list
      await refreshAllAppointments(ctx);
    }

    // Reject appointment
    else if (data.startsWith("reject_")) {
      const aptId = data.replace("reject_", "");

      const appointment = await Appointment.findById(aptId).populate("user");
      if (!appointment) return;

      await Appointment.findByIdAndUpdate(aptId, { status: "rejected" });

      const customer = appointment.user as any;
      if (customer.telegramId) {
        const aptTime = dayjs(appointment.time);
        await bot.api.sendMessage(
          customer.telegramId,
          `❌ התור שלך נדחה\n\n📅 תאריך: ${aptTime.format("DD/MM/YYYY")}\n⏰ שעה: ${aptTime.format("HH:mm")}\n\nאנא בחר תאריך או שעה אחרת.`
        );
      }

      await ctx.answerCallbackQuery({
        text: "❌ התור נדחה",
        show_alert: true,
      });

      await refreshAllAppointments(ctx);
    }

    // Barber cancel appointment
    else if (data.startsWith("barber_cancel_")) {
      const aptId = data.replace("barber_cancel_", "");

      const appointment = await Appointment.findById(aptId).populate("user");
      if (!appointment) return;

      await Appointment.findByIdAndDelete(aptId);

      const customer = appointment.user as any;
      if (customer.telegramId) {
        const aptTime = dayjs(appointment.time);
        await bot.api.sendMessage(
          customer.telegramId,
          `❌ התור שלך בוטל על ידי הספר\n\n📅 תאריך: ${aptTime.format("DD/MM/YYYY")}\n⏰ שעה: ${aptTime.format("HH:mm")}\n\nאנא צור קשר לפרטים נוספים.`
        );
      }

      await ctx.answerCallbackQuery({
        text: "✅ התור בוטל",
        show_alert: true,
      });

      await refreshAllAppointments(ctx);
    }

    // Cancel appointment (customer)
    else if (data.startsWith("cancel_")) {
      const aptId = data.replace("cancel_", "");
      await Appointment.findByIdAndDelete(aptId);

      await ctx.answerCallbackQuery({
        text: "✅ התור בוטל",
        show_alert: true,
      });

      // Refresh my appointments
      const user = await User.findOne({ telegramId: userId });
      if (!user) return;

      const appointments = await Appointment.find({
        user: user._id,
        time: { $gte: new Date() },
      }).sort({ time: 1 });

      if (appointments.length === 0) {
        await ctx.editMessageText("אין לך תורים קרובים.", {
          reply_markup: new InlineKeyboard().text(
            "🔙 תפריט ראשי",
            "back_to_menu"
          ),
        });
        return;
      }

      let message = "📋 התורים שלך:\n\n";
      const keyboard = new InlineKeyboard();

      appointments.forEach((apt, idx) => {
        const date = dayjs(apt.time);
        const status =
          apt.status === "approved"
            ? "✅ מאושר"
            : apt.status === "rejected"
            ? "❌ נדחה"
            : "⏳ ממתין לאישור";

        message += `${idx + 1}. ${date.format("DD/MM/YYYY")} בשעה ${date.format("HH:mm")}\n   סטטוס: ${status}\n\n`;

        keyboard.text(`🗑️ בטל תור ${idx + 1}`, `cancel_${apt._id}`).row();
      });

      keyboard.text("🔙 תפריט ראשי", "back_to_menu");

      await ctx.editMessageText(message, {
        reply_markup: keyboard,
      });
    }

    // Back to main menu
    else if (data === "back_to_menu") {
      const user = await User.findOne({ telegramId: userId });

      await ctx.editMessageText("תפריט ראשי:", {
        reply_markup: getMainMenu(user?.role === "barber"),
      });
    }

    // Slot unavailable
    else if (data === "slot_unavailable") {
      await ctx.answerCallbackQuery({
        text: "❌ השעה הזו תפוסה",
        show_alert: false,
      });
    }

    // No slots available
    else if (data === "no_slots") {
      await ctx.answerCallbackQuery({
        text: "אין שעות פנויות להיום, בחר יום אחר",
        show_alert: true,
      });
    }

    // Saturday is off
    else if (data === "day_off_saturday") {
      await ctx.answerCallbackQuery({
        text: "🚫 בשבת המספרה סגורה",
        show_alert: true,
      });
    }

    // Day off selected
    else if (data === "day_off_selected") {
      await ctx.answerCallbackQuery({
        text: "🏖️ הספר בחופש ביום הזה",
        show_alert: true,
      });
    }

    // Manage days off (barber only)
    else if (data === "manage_days_off") {
      const user = await User.findOne({ telegramId: userId });

      if (!user || user.role !== "barber") {
        await ctx.answerCallbackQuery({
          text: "❌ אין לך הרשאה",
          show_alert: true,
        });
        return;
      }

      await refreshDaysOffManagement(ctx);
    }

    // Add day off
    else if (data.startsWith("add_day_off_")) {
      const dateStr = data.replace("add_day_off_", "");

      const user = await User.findOne({ telegramId: userId });
      if (!user || user.role !== "barber") {
        await ctx.answerCallbackQuery({
          text: "❌ אין לך הרשאה",
          show_alert: true,
        });
        return;
      }

      await DayOff.create({ date: dateStr });

      await ctx.answerCallbackQuery({
        text: `✅ ${dayjs(dateStr).format("DD/MM/YYYY")} סומן כיום חופש`,
        show_alert: true,
      });

      await refreshDaysOffManagement(ctx);
    }

    // Remove day off
    else if (data.startsWith("remove_day_off_")) {
      const dateStr = data.replace("remove_day_off_", "");

      const user = await User.findOne({ telegramId: userId });
      if (!user || user.role !== "barber") {
        await ctx.answerCallbackQuery({
          text: "❌ אין לך הרשאה",
          show_alert: true,
        });
        return;
      }

      await DayOff.deleteOne({ date: dateStr });

      await ctx.answerCallbackQuery({
        text: `✅ ${dayjs(dateStr).format("DD/MM/YYYY")} הוסר מימי החופש`,
        show_alert: true,
      });

      await refreshDaysOffManagement(ctx);
    }

    // Answer callback to remove loading state (for unhandled cases)
    else {
      await ctx.answerCallbackQuery();
    }
  } catch (error) {
    console.error("Error handling callback:", error);
    await ctx.answerCallbackQuery({
      text: "❌ אירעה שגיאה",
      show_alert: true,
    });
  }
});

// Helper function to refresh all appointments view
async function refreshAllAppointments(ctx: Context) {
  const appointments = await Appointment.find({
    time: { $gte: new Date() },
  })
    .populate("user")
    .sort({ time: 1 });

  if (appointments.length === 0) {
    await ctx.editMessageText("אין תורים קרובים.", {
      reply_markup: new InlineKeyboard().text("🔙 תפריט ראשי", "back_to_menu"),
    });
    return;
  }

  let message = "👥 כל התורים:\n\n";
  const keyboard = new InlineKeyboard();

  appointments.forEach((apt, idx) => {
    const date = dayjs(apt.time);
    const status =
      apt.status === "approved"
        ? "✅"
        : apt.status === "rejected"
        ? "❌"
        : "⏳";

    message += `${idx + 1}. ${(apt.user as any).name}\n   ${date.format("DD/MM/YYYY HH:mm")} ${status}\n\n`;

    if (apt.status === "pending") {
      keyboard
        .text(`✅ אשר תור ${idx + 1}`, `approve_${apt._id}`)
        .text(`❌ דחה תור ${idx + 1}`, `reject_${apt._id}`)
        .row();
    } else {
      keyboard
        .text(`🗑️ בטל תור ${idx + 1}`, `barber_cancel_${apt._id}`)
        .row();
    }
  });

  keyboard.text("🔙 תפריט ראשי", "back_to_menu");

  await ctx.editMessageText(message, {
    reply_markup: keyboard,
  });
}

// Helper function to refresh days off management view
async function refreshDaysOffManagement(ctx: Context) {
  const daysOffDocs = await DayOff.find({});
  const daysOff = daysOffDocs.map((d) => d.date);

  const keyboard = new InlineKeyboard();
  const today = dayjs();

  for (let i = 0; i < 14; i++) {
    const date = today.add(i, "day");
    const dateStr = date.format("YYYY-MM-DD");
    const isSaturday = date.day() === 6;
    const isDayOff = daysOff.includes(dateStr);

    if (isSaturday) continue;

    const label = date.format("DD/MM (ddd)");
    const icon = isDayOff ? "🏖️" : "✅";

    keyboard
      .text(
        `${icon} ${label}`,
        isDayOff ? `remove_day_off_${dateStr}` : `add_day_off_${dateStr}`
      )
      .row();
  }

  keyboard.text("🔙 תפריט ראשי", "back_to_menu");

  await ctx.editMessageText(
    "🏖️ ניהול ימי חופש\n\n✅ = יום עבודה\n🏖️ = יום חופש\n\nלחץ על יום כדי לשנות:",
    {
      reply_markup: keyboard,
    }
  );
}

// Error handling
bot.catch((err) => {
  console.error("Bot error:", err);
});

console.log("✅ Telegram Bot is running...");

export default bot;
