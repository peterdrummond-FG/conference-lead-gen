// The number Twilio's SMS/MMS webhook is configured against. It isn't stored
// anywhere server-side (the app never needs to know its own number; Twilio just
// POSTs inbound messages to twilio-webhook), so this is the one place it's
// written down for display. Update here if the Twilio number ever changes.
//
// Lives in its own file so Setup and the welcome tour quote the same number: the
// tour used to be one copy-paste away from telling a new rep to text a number
// that no longer answers.
export const TWILIO_NUMBER_DISPLAY = '+1 (936) 218-1311';
// Same number, in the form an sms: link needs.
export const TWILIO_NUMBER_E164 = '+19362181311';
