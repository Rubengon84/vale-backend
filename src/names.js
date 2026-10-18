const EMAIL = /[^\s@]+@[^\s@]+/;

export const containsEmail = (text) => EMAIL.test(text);

// Members see each other's names, so a name must never reveal an email
// address. Auth0 uses the email as the name for email/password accounts:
// "juan.perez83@hotmail.com" becomes "Juan Perez".
export function safeDisplayName(name) {
  if (!containsEmail(name)) {
    return name;
  }
  const words = name
    .split("@")[0]
    .replace(/[._+-]+/g, " ")
    .replace(/\d+/g, "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1).toLowerCase());
  return words.length > 0 ? words.join(" ") : "Miembro";
}
