export const copy = {
  scanStarted: "I'm looking at that now — give me a moment.",
  scanFailed: "I couldn't read that clearly. Could you hold it steadier or move to better light?",
  nothingFound: "I didn't find anything to read in that image.",
  readerUnavailable: "I can't read photos on this device yet — that part isn't set up.",
  scanRead: (n: number) => `I read ${n} item(s).`,
  itemsListed: (n: number) => `${n} item(s).`,
  lastSeen: (locationNote: string) => `Last seen ${locationNote}.`,
  noLocation: (name: string) => `I don't have a location for ${name}.`,
  savedObject: (name: string) => `Saved ${name}.`,
  preferencesSaved: "Preferences saved.",
  toolFailed: "I couldn't do that — please choose the action again.",
  toolUnavailable: "I couldn't get that just now. Please try again.",
  invalidDate: "I couldn't understand that date. Please give me a calendar date.",
  actions: {
    alreadyDone: "That's already done.",
    remind: "I'll remind you about that.",
    schedule: "I've added that to your calendar.",
    flag: "I've flagged that for you.",
    file: "Filed.",
    discard: "Discarded.",
    share: (alias: string) => `Shared with ${alias}.`,
  },
  briefing: {
    clear: "Nothing needs your attention today.",
    due: (n: number) => `${n} due`,
    appointments: (n: number) => `${n} appointment(s)`,
    flagged: (n: number) => `${n} flagged`,
    reminders: (n: number) => `${n} reminder(s)`,
    summary: (parts: string[]) => `You have ${parts.join(", ")}.`,
  },
  disclaimers: {
    label:
      "This is the text on the label, not medical advice. Consult a healthcare provider for personal decisions.",
  },
  prompts: {
    morningBriefing:
      "Give me my morning briefing: what is due, what appointments are coming, and anything flagged.",
  },
} as const;
